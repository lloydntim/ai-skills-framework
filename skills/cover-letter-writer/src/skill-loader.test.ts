import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkillPrompt } from './skill-loader';
import { loadCandidateProfile, PRIVATE_PROFILE_PATH } from './candidate-profile';
import { referenceLeftOutByExport } from './reference-cv';

/**
 * Step 1 of the framework is "the skill text lives in exactly one file". These tests assert that
 * property directly: the instructions reach anything that needs them through this loader, so an
 * edit to SKILL.md is the only edit required.
 */
describe('skill loader', () => {
  it('loads the instructions from SKILL.md', () => {
    const prompt = loadSkillPrompt();

    expect(prompt).toContain('# Cover Letter Writing Skill');
    expect(prompt.length).toBeGreaterThan(500);
  });

  it('carries the hard rules, which are what the mechanical checks enforce', () => {
    const prompt = loadSkillPrompt();

    expect(prompt).toContain('## Hard rules (never break)');
    expect(prompt).toContain('Never upgrade ownership level');
    expect(prompt).toContain('Never leave a placeholder');
    expect(prompt).toContain('em dash');
  });

  it('does not itself contain an em dash or en dash, which it forbids in output', () => {
    const prompt = loadSkillPrompt();
    const body = prompt.replace(/- \*\*Never use an em dash.*$/m, '');

    expect(body).not.toMatch(/[—–]/);
  });

  it('throws a clear error rather than returning nothing when the file is missing', () => {
    expect(() => loadSkillPrompt(path.join(__dirname, 'no-such-skill.md'))).toThrow(
      /Skill file not found/,
    );
  });

  it('fills every candidate placeholder and leaves the letter slots for the model', () => {
    const prompt = loadSkillPrompt();

    expect(prompt).not.toMatch(/\{\{[A-Z][A-Z0-9_]*\}\}/);
    expect(prompt).toContain('{{salutation}}');
    expect(prompt).toContain('JORDAN SAMPLE\n{{positioning}}');
  });

  it('names the profile section that is missing rather than sending a broken prompt', () => {
    const { VOICE: _dropped, ...profile } = loadCandidateProfile();

    expect(() => loadSkillPrompt(undefined, profile)).toThrow(/VOICE/);
  });
});

describe('voice rules', () => {
  const prompt = loadSkillPrompt();

  it('gives the voice its own section, filled from the profile', () => {
    expect(prompt).toContain('## Voice\n\nThe letter must sound like the candidate wrote it.');
  });
});

describe('UK and Ireland rules', () => {
  const prompt = loadSkillPrompt();

  it('covers both markets', () => {
    expect(prompt).toContain('## Applying in the UK and Ireland');
  });

  it("states each market's right to work from the profile", () => {
    const profile = loadCandidateProfile();

    expect(prompt).toContain(`- **Ireland:** ${profile.IE_RIGHT_TO_WORK}`);
    expect(prompt).toContain(`- **United Kingdom:** ${profile.UK_RIGHT_TO_WORK}`);
  });

  it('forbids inventing a local phone number', () => {
    expect(prompt).toContain('Never invent a number');
  });
});

/**
 * The real candidate's voice and status, as the model sees them. Private regression checks: they
 * read reference/candidate-profile.md, so an exported copy skips them.
 */
describe.skipIf(referenceLeftOutByExport)("the candidate's skill", () => {
  const profile = referenceLeftOutByExport ? {} as Record<string, string> : loadCandidateProfile(PRIVATE_PROFILE_PATH);
  const prompt = referenceLeftOutByExport ? '' : loadSkillPrompt(undefined, profile);

  it('tells the model to write in the first person', () => {
    expect(prompt).toContain('do not avoid "I"');
  });

  it('no longer carries the rule that caused the drift', () => {
    // This rule was invented during the restructure and came from none of the source material.
    // Following it produced a letter where 6% of sentences opened with "I", against 27% and 44%
    // in the letters actually sent.
    expect(prompt).not.toContain('Do not open sentence after sentence with "I"');
    expect(prompt).not.toContain('prefer describing the work over announcing the self');
  });

  it('gives concrete wrong-and-right pairs, not just the rule', () => {
    expect(profile.VOICE.match(/^- Not ".+"\n- But ".+"$/gm)?.length).toBeGreaterThanOrEqual(4);
  });

  it('states the confirmed UK status and the sponsorship consequence', () => {
    // The first thing a British employer screens for. Confirmed by the candidate, so the letter
    // states it rather than staying silent, in a wording the UK check accepts.
    const [firstWording] = profile.UK_RIGHT_TO_WORK_WORDINGS.split(',');
    expect(profile.UK_RIGHT_TO_WORK).toContain(firstWording.trim());
    expect(prompt).toContain('no visa sponsorship is required');
    expect(prompt).toContain('Never state a different status');
  });

  it('lets the candidate state the right to work in Ireland in a wording the check accepts', () => {
    const wordings = profile.IE_RIGHT_TO_WORK_WORDINGS.split(',').map((w) => w.trim());
    expect(wordings.some((w) => profile.IE_RIGHT_TO_WORK.includes(w))).toBe(true);
  });
});
