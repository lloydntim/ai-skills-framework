import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractZipDocumentText, havePrivateReferenceData, identifiers, OPAQUE_DOCUMENT, privateLines, ZIP_DOCUMENT } from './privacy-scan';

/**
 * The export tests (export-skill.test.ts) check that private data never reaches an *exported*
 * archive. They would not have caught either L1 (a private CV line copied into a tracked,
 * exported fixture) or L2 (a tracked .docx, which the export leaves out by extension and which a
 * text-only scanner never opens): both leaks were in the repository itself, not introduced by the
 * export step. This file is the repository-level check the publication audit called for: it scans
 * every file Git actually tracks (`git ls-files`), not the filesystem and not an export, reusing
 * the same identifiers() and privateLines() detectors so there is one definition of "the
 * candidate's private data" for both checks.
 *
 * It only runs where reference/ is present to compare against — a public checkout has nothing to
 * detect a leak *from*, so there is nothing for this test to do there; see havePrivateReferenceData
 * in privacy-scan.ts. That is the state this test protects against: a private working checkout
 * accidentally publishing reference/ content into a file the future public remote would carry.
 */
const REPO_ROOT = path.resolve(__dirname, '..');

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * Private by design in this transitional checkout: a skill's reference/ folder (the candidate's
 * own material, tracked here only until it moves to its own private repository) and any private
 * skill. They are expected to hold private data locally. The risk this test guards against is that
 * data *leaves* one of these directories for a file elsewhere, not that it exists here at all.
 */
function isPrivateByDesign(p: string): boolean {
  return /(^|\/)reference\//.test(p) || p.startsWith('skills/private/');
}

const TEXT_FILE = /\.(ts|tsx|js|jsx|json|md|ya?ml|txt|sh|py|applescript|example|html|css)$/i;

/** Reads whatever text this scan knows how to get out of a tracked file, or null if it cannot. */
function readableText(absPath: string, relPath: string): string | null {
  if (TEXT_FILE.test(relPath)) return fs.readFileSync(absPath, 'utf-8');
  if (ZIP_DOCUMENT.test(relPath)) return extractZipDocumentText(fs.readFileSync(absPath));
  return null;
}

describe.skipIf(!havePrivateReferenceData)('tracked-tree privacy scan', () => {
  const publicPathFiles = trackedFiles().filter((p) => !isPrivateByDesign(p));

  it("never lets a candidate identifier into a publicly-tracked file (text or a ZIP-based document's XML)", () => {
    const checks = identifiers();
    const found: string[] = [];
    for (const file of publicPathFiles) {
      const text = readableText(path.join(REPO_ROOT, file), file);
      if (text === null) continue;
      for (const { label, pattern } of checks) {
        if (pattern.test(text)) found.push(`${file}: ${label}`);
      }
    }
    // Named by file and label only, never by the value that matched: a failing assertion here must
    // not become a second place the data leaked from.
    expect(found).toEqual([]);
  });

  it('never lets a line from the profile, the CVs or the private eval cases into a publicly-tracked file', () => {
    const lines = privateLines();
    expect(lines.size).toBeGreaterThan(100);
    const found: string[] = [];
    for (const file of publicPathFiles) {
      const text = readableText(path.join(REPO_ROOT, file), file);
      if (text === null) continue;
      for (const [line, source] of lines) {
        if (text.includes(line)) found.push(`${file} repeats ${source}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('tracks no PDF, legacy Office, RTF or Pages document outside reference/ (opaque to this scan)', () => {
    // Unlike .docx/.pptx/.xlsx/.odt, these formats are not a ZIP of XML, so this scan cannot read
    // their text. Rather than silently trust one, any tracked one outside reference/ is a finding.
    expect(publicPathFiles.filter((f) => OPAQUE_DOCUMENT.test(f))).toEqual([]);
  });
});
