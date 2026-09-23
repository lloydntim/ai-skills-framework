import { describe, expect, it } from 'vitest';
import { parsePromptFile, placeholdersIn, renderTemplate } from './prompt-file';

describe('parsePromptFile', () => {
  it('reads a system and a task part', () => {
    const parsed = parsePromptFile('## System\nBe strict.\n\n## Task\nCheck {{X}}.\n');
    expect(parsed.system).toBe('Be strict.');
    expect(parsed.task).toBe('Check {{X}}.');
  });

  it('treats a file without headings as a task only', () => {
    expect(parsePromptFile('Just text {{X}}')).toEqual({ task: 'Just text {{X}}' });
  });

  it('allows a system part with no task part', () => {
    expect(parsePromptFile('## System\nOnly this\n')).toEqual({ system: 'Only this', task: '' });
  });

  it('allows a task part with no system part', () => {
    expect(parsePromptFile('## Task\nDo {{X}}\n')).toEqual({ task: 'Do {{X}}' });
  });
});

describe('renderTemplate', () => {
  it('fills every placeholder', () => {
    expect(renderTemplate('a {{ONE}} b {{TWO}} {{ONE}}', { ONE: '1', TWO: '2' })).toBe('a 1 b 2 1');
  });

  it('inserts values exactly, including $ sequences and placeholder-looking text', () => {
    const out = renderTemplate('x {{A}} y {{B}}', { A: "cost $& and $$ and $'", B: '{{A}}' });
    expect(out).toBe("x cost $& and $$ and $' y {{A}}");
  });

  it('throws when a value is missing', () => {
    expect(() => renderTemplate('{{A}} {{B}}', { A: '1' })).toThrow(/B/);
  });

  it('throws when a value has no placeholder', () => {
    expect(() => renderTemplate('{{A}}', { A: '1', C: '3' })).toThrow(/C/);
  });

  it('lists placeholders once each', () => {
    expect(placeholdersIn('{{A}} {{B}} {{A}}')).toEqual(['A', 'B']);
  });
});
