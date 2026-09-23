/**
 * Runs the mechanical checks over a drafted letter and prints a readable report.
 *
 * There is no runtime loop in this project: the model drafts the letter by following SKILL.md, and
 * this script is how that draft gets verified. No API key, no tokens.
 *
 *   npx tsx scripts/check-letter.ts --letter draft.txt --spec spec.txt --lang en
 */
// Loads .env, so COVER_LETTER_PROFILE can point at a profile kept outside the repository.
import '@skills/framework/load-env-on-import';
import fs from 'node:fs';
import { runDeterministicChecks } from '../src/deterministic-checks';
import { parsePhraseBank } from '../src/phrase-bank';
import { parsePreferenceBank } from '../src/preference-bank';
import { loadAllReferenceCvs } from '../src/reference-cv';
import type { LetterLanguage } from '../src/templates';
import { MARKETS, contactRequirements, isMarket, rightToWork } from '../src/markets';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const letterPath = arg('letter');
const specPath = arg('spec');
if (!letterPath || !specPath) {
  console.error('usage: check-letter.ts --letter <file> --spec <file> [--cv <file>] [--lang en|de]');
  console.error('       [--allow-numbers 80,100] [--allow-tech Svelte,Strapi] [--market uk|ie|dach]');
  process.exit(2);
}

const list = (name: string) => (arg(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const language = (arg('lang') ?? 'en') as LetterLanguage;
const cvPath = arg('cv');

const market = arg('market');
if (market && !isMarket(market)) {
  console.error(`unknown --market "${market}". Use one of: ${MARKETS.join(', ')}`);
  process.exit(2);
}
const contact = market && isMarket(market)
  ? contactRequirements(market)
  : { require: [] as string[], forbid: [] as string[] };

const result = runDeterministicChecks({
  output: fs.readFileSync(letterPath, 'utf-8'),
  cvText: cvPath ? fs.readFileSync(cvPath, 'utf-8') : loadAllReferenceCvs(),
  roleDescription: fs.readFileSync(specPath, 'utf-8'),
  standardPhrases: parsePhraseBank(),
  preferences: parsePreferenceBank(),
  templateLanguage: language,
  allowedNumbers: list('allow-numbers'),
  allowedTechnologies: list('allow-tech'),
  requiredExactStrings: [...list('require'), ...contact.require],
  forbiddenClaims: contact.forbid,
  requiredAnyOf: market && isMarket(market) ? rightToWork()[market] : [],
  minWords: 230,
  maxWords: 400,
});

const show = (label: string, value: string[]) =>
  console.log(`  ${label.padEnd(26)} ${value.length ? value.join(', ') : '-'}`);

console.log(`\n${result.pass ? 'PASS' : 'FAIL'}   ${letterPath}   (${language}, ${result.wordCount} words)\n`);

console.log('HARD  (any of these fails the letter)');
show('missing required text', result.missingExactStrings.concat(result.missingTerms));
show('missing right to work', result.missingRequiredGroups);
show('forbidden claims', result.matchedForbiddenClaims);
show('em / en dashes', result.matchedForbiddenCharacters);
show('unfilled placeholders', result.unfilledPlaceholders);
show('tech not in the CV', result.unsupportedTechnologies);
show('numbers not in the CV', result.unsupportedNumbers);
show('phrases CV cannot support', result.phrasesWithoutCvSupport);
show('benefits spec never offered', result.unofferedPreferences);
show('missing letter structure', result.missingLetterStructure);

console.log('\nSOFT  (worth a rewrite, does not fail)');
show('length', result.wordCountOutOfRange ? [`${result.wordCount} outside 230-400`] : []);
show('cliches', result.matchedCliches);
show('repeated sentence openers', result.repeatedSentenceOpeners);
show('opening restates the advert', result.openingRestatesAdvert);
show('phrases used off-trigger', result.untriggeredPhrases);

console.log('\nUSED');
show('standard phrases', result.usedStandardPhrases);
show('job preferences', result.usedPreferences);
console.log();

process.exit(result.pass ? 0 : 1);
