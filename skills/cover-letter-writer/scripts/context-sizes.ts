/**
 * Prints how much of SKILL.md the generator and reviser receive for each language and market, in
 * 'full' and 'by-task' mode, and which sections 'by-task' leaves out. Sizes only, never text, so
 * it is safe to run against the real candidate profile. No model call.
 *
 *   npx tsx scripts/context-sizes.ts
 *   COVER_LETTER_PROFILE=candidate-profile.example.md npx tsx scripts/context-sizes.ts
 */
import { MARKETS, type Market } from '../src/markets';
import { loadSkillPrompt } from '../src/skill-loader';
import { selectSkillSections } from '../src/skill-sections';
import type { LetterLanguage } from '../src/templates';

const LANGUAGES: LetterLanguage[] = ['en', 'de'];

function main() {
  const full = loadSkillPrompt();
  console.log('SKILL.md as sent to the generator and reviser (characters, not tokens)');
  console.log(`full: ${full.length.toLocaleString('en-GB')} for every letter`);
  console.log('');
  console.log('by-task:');
  for (const language of LANGUAGES) {
    for (const market of [...MARKETS, undefined] as Array<Market | undefined>) {
      const { text, omitted } = selectSkillSections(full, { language, market });
      const saved = full.length - text.length;
      const pct = ((saved / full.length) * 100).toFixed(1);
      console.log(
        `  ${language} ${(market ?? 'no market').padEnd(9)} ${text.length.toLocaleString('en-GB').padStart(6)}  ` +
          `(-${saved.toLocaleString('en-GB')}, -${pct}%)  left out: ${omitted.join(', ') || 'nothing'}`
      );
    }
  }
}

main();
