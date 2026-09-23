import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the installer. The build strips two things out of SKILL.md by pattern: the H1, and
 * the "## Output format" section that the chat wrapper replaces. Rename either in SKILL.md and the
 * strip silently stops matching, shipping a skill with two contradictory output sections. That
 * would not fail anything else, and would not be visible without reading the built file.
 *
 * Built against the fictional example profile, not whichever one happens to be on disk: this is a
 * structural smoke test of the build script, so it must not depend on the candidate's private
 * profile being present, and stays deterministic either way.
 */
const built = (() => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clw-')), 'SKILL.md');
  execFileSync(
    'npx',
    ['tsx', path.join(__dirname, 'build-claude-skill.ts'), `--out=${out}`, '--no-command=true'],
    { encoding: 'utf-8', env: { ...process.env, COVER_LETTER_PROFILE: path.join(__dirname, '..', 'candidate-profile.example.md') } },
  );
  return fs.readFileSync(out, 'utf-8');
})();

describe('the built Claude skill', () => {
  it('carries frontmatter naming the skill', () => {
    expect(built.startsWith('---\nname: cover-letter-writer')).toBe(true);
  });

  it('has exactly one Output section, not the source one plus the wrapper one', () => {
    expect(built.match(/^## Output/gm)).toHaveLength(1);
  });

  it('drops the source Output format section, whose rules are CLI-shaped', () => {
    expect(built).not.toContain('## Output format');
  });

  it('carries the whole phrase bank', () => {
    expect(built).toContain('## Standard phrases');
    expect(built).toContain('performance-seo');
    expect(built).toContain('bilingual-dach');
  });

  it('carries the whole preference bank', () => {
    expect(built).toContain('## Job preferences');
    expect(built).toContain('remote-work');
    expect(built).toContain('learning-budget');
  });

  it('carries both letter templates', () => {
    expect(built).toContain('cover-letter-en');
    expect(built).toContain('cover-letter-de');
    expect(built).toContain('Hallo {{salutation}},');
  });

  it('carries the hard rules', () => {
    expect(built).toContain('## Hard rules (never break)');
    expect(built).toContain('Never upgrade ownership level');
    expect(built).toContain('Never attribute a benefit');
  });

  it('adds the chat-only self-check, since no validator runs in a chat session', () => {
    expect(built).toContain('## Before you respond, self-check');
  });

  it('leaves no unfilled template placeholder of its own', () => {
    expect(built).not.toContain('{{RULES}}');
  });
});
