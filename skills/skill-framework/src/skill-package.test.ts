import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSkillPackage } from '@skills/framework/manifest/check-skill-package';

describe('skill package', () => {
  it('follows the standard skill layout', () => {
    expect(checkSkillPackage(path.join(__dirname, '..'))).toEqual([]);
  });
});
