export interface DeterministicCheckInput {
  output: string;
  requiredExactStrings?: string[];
  requiredTerms?: string[];
  forbiddenClaims?: string[];
  forbiddenCharacters?: string[];
  sourceText?: string;
  maxLengthRatio?: number;
}

export interface DeterministicCheckResult {
  pass: boolean;
  missingExactStrings: string[];
  missingTerms: string[];
  matchedForbiddenClaims: string[];
  matchedForbiddenCharacters: string[];
  lengthRatio?: number;
  lengthExceeded: boolean;
  boldMarkerMismatch: boolean;
  sourceBoldMarkerCount?: number;
  outputBoldMarkerCount?: number;
  paragraphBreakMismatch: boolean;
  sourceParagraphBreakCount?: number;
  outputParagraphBreakCount?: number;
  repeatedEntryOpeners: string[];
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function runDeterministicChecks(input: DeterministicCheckInput): DeterministicCheckResult {
  const requiredExactStrings = input.requiredExactStrings ?? [];
  const requiredTerms = input.requiredTerms ?? [];
  const forbiddenClaims = input.forbiddenClaims ?? [];
  const forbiddenCharacters = input.forbiddenCharacters ?? [];

  const missingExactStrings = requiredExactStrings.filter((s) => !input.output.includes(s));
  const missingTerms = requiredTerms.filter((t) => !containsCaseInsensitive(input.output, t));
  const matchedForbiddenClaims = forbiddenClaims.filter((c) => containsCaseInsensitive(input.output, c));
  const matchedForbiddenCharacters = forbiddenCharacters.filter((c) => input.output.includes(c));

  let lengthRatio: number | undefined;
  let lengthExceeded = false;
  let sourceBoldMarkerCount: number | undefined;
  let outputBoldMarkerCount: number | undefined;
  let boldMarkerMismatch = false;
  let sourceParagraphBreakCount: number | undefined;
  let outputParagraphBreakCount: number | undefined;
  let paragraphBreakMismatch = false;

  if (input.sourceText && input.sourceText.length > 0) {
    if (input.maxLengthRatio !== undefined) {
      lengthRatio = input.output.length / input.sourceText.length;
      lengthExceeded = lengthRatio > input.maxLengthRatio;
    }

    // Markdown bold markers ("**") are structural formatting (e.g. bold lead-in labels on CV
    // achievement bullets). If the source uses them, the output must use the same number of them —
    // this is a mechanical structural check, distinct from and complementary to the "preserve
    // formatting" instruction in SKILL.md. Text without any "**" trivially passes (0 === 0), so
    // this never produces a false failure on plain prose.
    const countBoldMarkers = (text: string) => (text.match(/\*\*/g) ?? []).length;
    sourceBoldMarkerCount = countBoldMarkers(input.sourceText);
    outputBoldMarkerCount = countBoldMarkers(input.output);
    boldMarkerMismatch = sourceBoldMarkerCount !== outputBoldMarkerCount;

    // Structural line/paragraph breaks matter (merging or dropping a CV entry breaks a template),
    // but the exact newline style used to separate them doesn't — a source pasted with single line
    // breaks between sentences and a translation that reflows those into blank-line-separated
    // paragraphs are structurally equivalent, not a formatting loss. So this counts structural
    // *blocks* (runs of one-or-more newlines treated as a single separator) rather than requiring
    // an identical count of literal blank-line breaks. Same mechanism as the bold-marker check:
    // trivially equal (both single-block) on unbroken prose, so it never produces a false failure there.
    const countBlocks = (text: string) =>
      text
        .split(/\n+/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0).length;
    sourceParagraphBreakCount = countBlocks(input.sourceText) - 1;
    outputParagraphBreakCount = countBlocks(input.output) - 1;
    paragraphBreakMismatch = sourceParagraphBreakCount !== outputParagraphBreakCount;
  }

  // Opening the same way in several bullets of one list reads repetitive, even when each word is
  // individually correct (and even when the source itself repeats). Only the first word after any
  // bold label is compared. Prose without a bullet list yields no entries and is never flagged.
  const entryOpeners: string[] = [];
  for (const line of input.output.split('\n')) {
    const match = line.match(/^\s*[•\-*]\s+(?:\*\*.*?\*\*:?\s*)?(\p{L}+)/u);
    if (match) entryOpeners.push(match[1].toLowerCase());
  }
  const openerCounts = new Map<string, number>();
  for (const opener of entryOpeners) {
    openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1);
  }
  const repeatedEntryOpeners =
    entryOpeners.length >= 3
      ? [...openerCounts.entries()].filter(([, count]) => count > 1).map(([opener]) => opener)
      : [];

  return {
    // Length (spec section 15's "maximum length" check) and repeated entry openers are soft/quality
    // concerns, not hard fact-preservation guardrails, so neither affects `pass` — callers that want
    // to react to them (e.g. the runtime validator) read `lengthExceeded` and `repeatedEntryOpeners`
    // explicitly and treat them as revision triggers rather than failures. Forbidden characters and
    // structural-formatting mismatches, by contrast, are unambiguous hard rules, so they do affect `pass`.
    pass:
      missingExactStrings.length === 0 &&
      missingTerms.length === 0 &&
      matchedForbiddenClaims.length === 0 &&
      matchedForbiddenCharacters.length === 0 &&
      !boldMarkerMismatch &&
      !paragraphBreakMismatch,
    missingExactStrings,
    missingTerms,
    matchedForbiddenClaims,
    matchedForbiddenCharacters,
    lengthRatio,
    lengthExceeded,
    boldMarkerMismatch,
    sourceBoldMarkerCount,
    outputBoldMarkerCount,
    paragraphBreakMismatch,
    sourceParagraphBreakCount,
    outputParagraphBreakCount,
    repeatedEntryOpeners,
  };
}
