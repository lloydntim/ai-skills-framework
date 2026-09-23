import { describe, expect, it } from 'vitest';
import { importSpecifiers } from './imports';

describe('importSpecifiers', () => {
  it('finds static, multi-line, type-only, re-export and side-effect imports', () => {
    const source = [
      "import a from './a';",
      "import type { B } from '../b';",
      'import {',
      '  c,',
      '  d,',
      "} from '@skills/framework/hash';",
      "export { e } from './e';",
      "import './side-effect';",
    ].join('\n');
    expect(importSpecifiers(source).sort()).toEqual(['../b', './a', './e', './side-effect', '@skills/framework/hash']);
  });

  it('finds dynamic imports, require and vi.mock', () => {
    const source = "const m = await import('./dyn');\nconst r = require('./req');\nvi.mock('./mocked', () => ({}));";
    expect(importSpecifiers(source).sort()).toEqual(['./dyn', './mocked', './req']);
  });

  it('ignores import text that is only inside a string', () => {
    const source = "write('src/bad.ts', \"import x from '../../other/x';\");\nconst s = `import y from './y'`;";
    expect(importSpecifiers(source)).toEqual([]);
  });
});
