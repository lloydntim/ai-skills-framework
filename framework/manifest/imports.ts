import ts from 'typescript';

/**
 * The module names a TypeScript file imports, found by TypeScript's own scanner. Text that only
 * looks like an import, such as one inside a string in a test, is not counted. `vi.mock('...')`
 * calls are added because the scanner does not know about them.
 */
const VI_MOCK = /^[ \t]*vi\.(?:mock|importActual)\(\s*['"]([^'"]+)['"]/gm;

export function importSpecifiers(source: string): string[] {
  const found = new Set(ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName));
  for (const match of source.matchAll(VI_MOCK)) found.add(match[1]);
  return [...found];
}
