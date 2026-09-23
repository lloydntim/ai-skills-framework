import { describe, expect, it } from 'vitest';
import { checkSkillPackage } from '@skills/framework/manifest/check-skill-package';
import { SKILL_DIR } from './skill-dir';

describe('skill package', () => {
  it('follows the standard skill layout', () => {
    expect(checkSkillPackage(SKILL_DIR)).toEqual([]);
  });
});
