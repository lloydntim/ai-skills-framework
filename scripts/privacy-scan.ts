import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseCandidateProfile, type CandidateProfile } from '../skills/cover-letter-writer/src/candidate-profile';

/**
 * Everything private about the candidate lives in cover-letter-writer's reference/ folder: the
 * profile the skill is filled from, the reference CVs, and the eval cases built from the CV. This
 * module builds the two detectors used to check that none of it leaked somewhere it should not
 * be — an export archive (scripts/export-skill.test.ts) or the tracked working tree
 * (scripts/tracked-tree-privacy.test.ts). Both reuse this one implementation, so there is a single
 * place that knows what "the candidate's private data" means.
 */
export const PRIVATE_DIR = path.join(__dirname, '..', 'skills', 'cover-letter-writer', 'reference');
const PROFILE_FILE = path.join(PRIVATE_DIR, 'candidate-profile.md');

/** False in a public checkout, where reference/ was never mounted. Both detectors are no-ops then. */
export const havePrivateReferenceData = fs.existsSync(PROFILE_FILE);

export function loadPrivateProfile(): CandidateProfile {
  return havePrivateReferenceData ? parseCandidateProfile(fs.readFileSync(PROFILE_FILE, 'utf-8')) : {};
}

/** Contact details and handles, matched case-insensitively and across phone-number spacing. */
export function identifiers(profile: CandidateProfile = loadPrivateProfile()): { label: string; pattern: RegExp }[] {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameParts = (profile.CANDIDATE_NAME ?? '').split(/\s+/).filter((p) => p.length >= 3);
  const phoneDigits = (phone: string) => phone.replace(/^\+\d{2}/, '').replace(/\D/g, '');
  return [
    ...nameParts.map((part, i) => ({ label: `CANDIDATE_NAME part ${i + 1}`, pattern: new RegExp(`\\b${escape(part)}\\b`, 'i') })),
    { label: 'CANDIDATE_NAME joined', pattern: new RegExp(escape(nameParts.join('')), 'i') },
    ...['EMAIL', 'LINKEDIN', 'GITHUB', 'PORTFOLIO'].map((key) => ({ label: key, pattern: new RegExp(escape(profile[key]), 'i') })),
    ...['UK_PHONE', 'DACH_PHONE'].map((key) => ({
      label: key,
      pattern: new RegExp(phoneDigits(profile[key]).split('').join('[\\s-]?')),
    })),
  ];
}

/** Every line of 40 characters or more from the private text, with where it came from. */
export function privateLines(profile: CandidateProfile = loadPrivateProfile()): Map<string, string> {
  const lines = new Map<string, string>();
  const addText = (source: string, text: string | undefined) =>
    (text ?? '').split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.length >= 40 && !lines.has(trimmed)) lines.set(trimmed, `${source}:${i + 1}`);
    });
  if (!havePrivateReferenceData) return lines;
  for (const value of Object.values(profile)) addText('reference/candidate-profile.md', value);
  // Only the CV itself: above the first rule is the notice build-reference-cv.ts writes.
  for (const cv of ['cv.md', 'cv-de.md']) {
    const cvPath = path.join(PRIVATE_DIR, cv);
    if (!fs.existsSync(cvPath)) continue;
    const cvLines = fs.readFileSync(cvPath, 'utf-8').split('\n');
    const rule = cvLines.indexOf('---');
    addText(`reference/${cv}`, cvLines.map((line, i) => (i < rule ? '' : line)).join('\n'));
  }
  for (const set of ['golden', 'benchmark']) {
    const dir = path.join(PRIVATE_DIR, 'evals', set);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      for (const kase of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))) {
        addText(`reference/evals/${set}/${file} ${kase.id}`, kase.cvText);
      }
    }
  }
  return lines;
}

/**
 * Minimal ZIP reader, just enough to pull XML parts out of an Office/OpenDocument file (.docx,
 * .pptx, .xlsx, .odt are all a ZIP of XML). No dependency is added for this: the format is a
 * central directory of entries, each optionally deflate-compressed, which node:zlib already knows
 * how to inflate. This exists because L2 was exactly this case: a tracked .docx carried real
 * contact details in its XML, and a scanner that only reads text files could never see it.
 */
function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  const entries = new Map<string, Buffer>();
  if (eocd === -1) return entries;

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CD_SIG) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf-8', offset + 46, offset + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);
    try {
      if (method === 0) entries.set(name, Buffer.from(compData));
      else if (method === 8) entries.set(name, zlib.inflateRawSync(compData));
    } catch {
      // An entry that fails to inflate is skipped rather than failing the whole scan; every other
      // entry (in particular docProps/core.xml, where L2's metadata lived) is still checked.
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Office/OpenDocument formats this scan can look inside, because they are a ZIP of XML. */
export const ZIP_DOCUMENT = /\.(docx|pptx|xlsx|odt)$/i;

/** Other document formats this scan cannot read the text of, so a tracked one is flagged outright. */
export const OPAQUE_DOCUMENT = /\.(pdf|doc|ppt|xls|rtf|pages)$/i;

/** All the visible text this scan can pull out of a ZIP-based document's XML parts, concatenated. */
export function extractZipDocumentText(buf: Buffer): string {
  const entries = readZipEntries(buf);
  const parts: string[] = [];
  for (const [name, data] of entries) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) parts.push(data.toString('utf-8'));
  }
  return parts.join('\n');
}
