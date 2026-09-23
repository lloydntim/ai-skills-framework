/**
 * Generates a reference CV from the source PDF, so reference/cv.md stops being a hand
 * transcription that nobody can verify and becomes a reproducible build step.
 *
 *   npm run build:cv -- --pdf "reference/cv/<file>.pdf" --out reference/cv.md --label "English CV"
 *
 * Requires poppler (pdftotext). Three normalisations are applied, all deliberate:
 *
 *  1. Words hyphenated across a line break are rejoined with the hyphen kept. Every such break in
 *     this CV is a real compound (OWASP-aligned, three-day, store-locator), so joining without the
 *     hyphen would corrupt the word.
 *  2. Em and en dashes become plain hyphens. The skill forbids both in a letter, including in a
 *     numeric range, so a reference reading "~50–100" could never be quoted by a compliant letter.
 *  3. Typographic quotes become straight ones, so a check for "the project's second engineer"
 *     matches regardless of which apostrophe the word processor produced.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const pdf = arg('pdf');
const out = arg('out');
const label = arg('label') ?? 'CV';
if (!pdf || !out) {
  console.error('usage: build-reference-cv.ts --pdf <file.pdf> --out <file.md> [--label "English CV"]');
  process.exit(2);
}

let raw: string;
try {
  raw = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf-8', maxBuffer: 32e6 });
} catch {
  console.error('pdftotext not found. Install poppler (brew install poppler) and retry.');
  process.exit(2);
}

const text = raw
  .replace(/-\r?\n\s*/g, '-')
  .replace(/[—–]/g, '-')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .split('\n')
  .map((line) => line.replace(/\s+$/, '').replace(/^\s{2,}/, '  ').replace(/ {2,}/g, ' '))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const header = `# Reference CV: ${label}

Generated from \`${pdf}\` by \`npm run build:cv\`. Do not edit by hand: regenerate it when the CV
changes, so it cannot drift from the document that is actually sent.

This is not an input to letter writing. Letters are written from whatever CV is pasted into the
conversation. This copy exists so the phrase bank can be checked against a known CV.

Normalised on generation: words hyphenated across a line break rejoined, em and en dashes replaced
with plain hyphens, typographic quotes replaced with straight ones.

---

`;

fs.writeFileSync(out, header + text + '\n');
console.log(`${out}  <-  ${pdf}  (${text.split(/\s+/).length} words)`);
