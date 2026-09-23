import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { placeholdersIn } from '@skills/framework/prompts/prompt-file';
import { makeUniformRoles } from '@skills/framework/testing/uniform-roles';
import {
  CODE_PROFILE_KEYS,
  EXAMPLE_PROFILE_PATH,
  PRIVATE_PROFILE_PATH,
  loadCandidateProfile,
  parseCandidateProfile,
} from './candidate-profile';
import { loadSkillPrompt } from './skill-loader';
import { referenceLeftOutByExport } from './reference-cv';
import { runProductionSkill } from './runtime';
import { FakeModelProvider } from './test-support/fake-model-provider';
import type { RuntimeConfig } from './runtime/types';

const SKILL_DIR = path.join(__dirname, '..');
const skillTemplate = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8');
const adapterTemplate = fs.readFileSync(path.join(SKILL_DIR, 'adapters', 'claude', 'skill-template.md'), 'utf-8');

/** Every key a profile must carry: each placeholder in SKILL.md, plus the keys code reads. */
const REQUIRED_KEYS = [...new Set([...placeholdersIn(skillTemplate), ...CODE_PROFILE_KEYS])].sort();

describe('parsing a profile', () => {
  it('reads one value per section, ignoring the description above the first', () => {
    const profile = parseCandidateProfile('# About\n\nIgnored.\n\n## NAME\n\nAda\n\n## BLOCK\n\nline one\n\nline two\n');

    expect(profile).toEqual({ NAME: 'Ada', BLOCK: 'line one\n\nline two' });
  });

  it('keeps a lower-case heading inside a value, since only KEY headings start a section', () => {
    expect(parseCandidateProfile('## NOTES\n\n## not a key\ntext\n')).toEqual({ NOTES: '## not a key\ntext' });
  });

  it('refuses a key given twice, rather than silently keeping one', () => {
    expect(() => parseCandidateProfile('## NAME\n\nA\n\n## NAME\n\nB\n')).toThrow(/two "## NAME" sections/);
  });

  it('says how to create a profile when there is none', () => {
    expect(() => loadCandidateProfile('/no/such/profile.md')).toThrow(/candidate-profile\.example\.md/);
  });

  it('refuses a profile missing a key that code reads', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-')), 'p.md');
    fs.writeFileSync(file, '## CANDIDATE_NAME\n\nAda\n');

    expect(() => loadCandidateProfile(file)).toThrow(/EMAIL/);
  });
});

describe('the example profile', () => {
  const example = loadCandidateProfile(EXAMPLE_PROFILE_PATH);

  it('carries exactly the keys the skill asks for, so it documents all of them', () => {
    expect(Object.keys(example).sort()).toEqual(REQUIRED_KEYS);
  });

  it('is the profile the tests run against', () => {
    expect(loadCandidateProfile()).toEqual(example);
  });

  it('fills the skill completely, with no dash the skill forbids', () => {
    const prompt = loadSkillPrompt(undefined, example);

    expect(prompt).not.toMatch(/\{\{[A-Z][A-Z0-9_]*\}\}/);
    expect(prompt.replace(/- \*\*Never use an em dash.*$/m, '')).not.toMatch(/[—–]/);
  });
});

describe('the reusable skill', () => {
  it('asks for the candidate by placeholder in SKILL.md and the chat wrapper', () => {
    expect(placeholdersIn(skillTemplate)).toEqual(
      expect.arrayContaining(['CANDIDATE_NAME', 'UK_PHONE', 'DACH_PHONE', 'STANDARD_PHRASES', 'JOB_PREFERENCES', 'VOICE']),
    );
    expect(placeholdersIn(adapterTemplate)).toEqual(['RULES', 'CANDIDATE_NAME']);
  });
});

/**
 * The real candidate's profile. It is private, so these checks read reference/ and an exported
 * copy skips them. They compare against the profile's own values and hold no personal data.
 */
describe.skipIf(referenceLeftOutByExport)("the candidate's profile", () => {
  const profile = referenceLeftOutByExport ? {} : loadCandidateProfile(PRIVATE_PROFILE_PATH);

  it('carries exactly the keys the skill asks for', () => {
    expect(Object.keys(profile).sort()).toEqual(REQUIRED_KEYS);
  });

  it('fills the skill with no dash the skill forbids', () => {
    const prompt = loadSkillPrompt(undefined, profile);
    expect(prompt.replace(/- \*\*Never use an em dash.*$/m, '')).not.toMatch(/[—–]/);
  });

  it.each(['SKILL.md', 'adapters/claude/skill-template.md', 'candidate-profile.example.md', 'src/markets.ts'])(
    'leaves none of its values in the reusable %s',
    (file) => {
      const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf-8');
      // UK_LOCATION is a city name that any profile could share, so it is not a sign of a leak.
      const leaked = Object.entries(profile).filter(([key, value]) => key !== 'UK_LOCATION' && text.includes(value));
      expect(leaked.map(([key]) => key)).toEqual([]);
    },
  );
});

describe('taking the profile at run time', () => {
  const config: RuntimeConfig = {
    temperature: 0.3,
    maxOutputTokens: 4000,
    maxRevisionAttempts: 0,
    thresholds: { factualGrounding: 1, jobRelevance: 1, professionalTone: 1, specificity: 1, naturalness: 1, overall: 1 },
  };
  const before = process.env.COVER_LETTER_PROFILE;
  afterEach(() => {
    process.env.COVER_LETTER_PROFILE = before;
  });

  it('writes and checks the letter with whichever profile COVER_LETTER_PROFILE names', async () => {
    const other = fs
      .readFileSync(EXAMPLE_PROFILE_PATH, 'utf-8')
      .replaceAll('Jordan Sample', 'Robin Other')
      .replaceAll('JORDAN SAMPLE', 'ROBIN OTHER')
      .replace('+44 7700 900123', '+44 7700 900456');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-')), 'candidate-profile.md');
    fs.writeFileSync(file, other);
    process.env.COVER_LETTER_PROFILE = file;

    const provider = new FakeModelProvider()
      .queueResponse({ text: 'Dear Team,\n\nA letter.' })
      .queueResponse({ text: JSON.stringify({ factualGrounding: 5, jobRelevance: 5, professionalTone: 5, specificity: 5, naturalness: 5, overall: 5, hardGuardrailFailures: [] }) });
    const result = await runProductionSkill(
      { cvText: 'CV', roleDescription: 'A London role.', instructions: 'Write it.', language: 'en', market: 'uk' },
      makeUniformRoles(provider),
      config,
    );

    const [generation] = provider.requests;
    expect(generation.systemPrompt).toContain('ROBIN OTHER\n{{positioning}}');
    expect(generation.systemPrompt).not.toContain('Jordan Sample');
    expect(generation.userPrompt).toContain('Contact block to use: London, UK | +44 7700 900456 | jordan.sample@example.com');
    expect(result.finalValidation.deterministic.missingExactStrings).toContain('+44 7700 900456');
  });
});
