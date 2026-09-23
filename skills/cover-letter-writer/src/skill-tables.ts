import { loadSkillPrompt } from './skill-loader';

/**
 * Reads a markdown table out of a section of SKILL.md.
 *
 * Both the phrase bank and the preference bank live as tables in the skill file itself, so the
 * model is shown exactly the rows the checks enforce and the two cannot drift. That makes adding a
 * row one edit, in the file that ships. Malformed rows are skipped rather than guessed at.
 */
export function parseSkillTable(
  heading: string,
  columns: number,
  skillText: string = loadSkillPrompt(),
): string[][] {
  const start = skillText.indexOf(heading);
  if (start === -1) return [];

  const rest = skillText.slice(start + heading.length);
  const nextHeading = rest.search(/^## /m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const rows: string[][] = [];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== columns) continue;
    // Skips the header row and the "|---|---|" separator beneath it.
    if (cells[0] === 'ID' || /^-+$/.test(cells[0])) continue;
    if (cells.some((cell) => cell.length === 0)) continue;

    rows.push(cells);
  }

  return rows;
}

/** Comma-separated trigger lists, as used by both banks. */
export function splitTriggers(cell: string): string[] {
  return cell
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
