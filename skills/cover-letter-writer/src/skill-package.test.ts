import { describe, expect, it } from 'vitest';
import { checkSkillPackage } from '@skills/framework/manifest/check-skill-package';
import { SKILL_DIR } from './skill-dir';
import { referenceLeftOutByExport } from './reference-cv';

describe('skill package', () => {
  it('follows the standard skill layout', () => {
    // The golden and benchmark cases are built from the candidate's real CV, so they live in
    // reference/evals/, which an exported copy does not have. Only there is their absence expected.
    const problems = checkSkillPackage(SKILL_DIR).filter(
      (problem) => !(referenceLeftOutByExport && /^dataset "(golden|benchmark)": .*[/\\]reference[/\\]evals[/\\]/.test(problem)),
    );
    expect(problems).toEqual([]);
  });
});
