import { describe, expect, it } from 'vitest';
import { REQUIRED_STRUCTURE, getTemplate, parseTemplates } from './templates';
import { extractLetterBody, runDeterministicChecks } from './deterministic-checks';

describe('the shipped templates', () => {
  const templates = parseTemplates();

  it('carries one template per language', () => {
    expect(templates.map((t) => t.language).sort()).toEqual(['de', 'en']);
  });

  it.each(['en', 'de'] as const)('%s template has the six body paragraphs', (language) => {
    const template = getTemplate(language);
    expect(template).toBeDefined();

    for (const slot of [
      'p1_hook',
      'p2_credentials',
      'p3_stack_match',
      'p4_breadth',
      'p5_domain_affinity',
      'p6_motivation_close',
    ]) {
      expect(template!.slots).toContain(slot);
    }
  });

  it.each(['en', 'de'] as const)('%s template has the addressing slots', (language) => {
    const template = getTemplate(language)!;
    for (const slot of ['recipient', 'date', 'role_title', 'company', 'salutation']) {
      expect(template.slots).toContain(slot);
    }
  });

  it('gives both languages the same slots, so one CV fills either', () => {
    expect([...getTemplate('en')!.slots].sort()).toEqual([...getTemplate('de')!.slots].sort());
  });

  it.each(['en', 'de'] as const)('%s letter carries every contact detail exactly once', (language) => {
    const t = getTemplate(language)!;

    for (const slot of ['location', 'phone', 'email', 'portfolio', 'linkedin', 'github']) {
      expect(t.slots).toContain(slot);
      expect(t.body.match(new RegExp(`\\{\\{${slot}\\}\\}`, 'g'))).toHaveLength(1);
    }
  });

  it.each(['en', 'de'] as const)('%s header carries location and the two profiles', (language) => {
    const header = getTemplate(language)!.body.split('\n')[2];

    expect(header).toBe('{{location}} | {{linkedin}} | {{github}}');
  });

  it.each(['en', 'de'] as const)('%s signature carries phone, email and portfolio', (language) => {
    const body = getTemplate(language)!.body;

    expect(body).toContain('Phone: {{phone}}');
    expect(body).toContain('Email: {{email}}');
    expect(body).toContain('Portfolio: {{portfolio}}');
  });

  it.each(['en', 'de'] as const)('%s keeps the two blocks disjoint', (language) => {
    // The header must not repeat anything the signature carries, and vice versa.
    const lines = getTemplate(language)!.body.split('\n');
    const header = lines[2];

    for (const slot of ['phone', 'email', 'portfolio']) {
      expect(header).not.toContain(`{{${slot}}}`);
    }
    const signature = lines.slice(-3).join('\n');
    for (const slot of ['linkedin', 'github', 'location']) {
      expect(signature).not.toContain(`{{${slot}}}`);
    }
  });

  it.each(['en', 'de'] as const)('%s template satisfies its own structural markers', (language) => {
    const body = getTemplate(language)!.body.toLowerCase();
    for (const group of REQUIRED_STRUCTURE[language]) {
      expect(group.some((marker) => body.includes(marker.toLowerCase()))).toBe(true);
    }
  });

  it.each(['en', 'de'] as const)('%s template uses no dash the skill forbids', (language) => {
    expect(getTemplate(language)!.body).not.toMatch(/[—–]/);
  });

  it('uses the register the sent Anschreiben actually use', () => {
    const body = getTemplate('de')!.body;

    expect(body).toContain('Hallo {{salutation}},');
    expect(body).toContain('Viele Grüße,');
  });

  it('returns nothing for a document with no fenced templates', () => {
    expect(parseTemplates('# Skill\n\n## Role\nWrite letters.')).toEqual([]);
  });

  it('does not confuse an ordinary fenced block for a template', () => {
    expect(parseTemplates('```\ncover-letter-en\nnot a template\n```')).toEqual([]);
  });
});

describe('the structural check', () => {
  it('passes a letter that follows the English house format', () => {
    const result = runDeterministicChecks({
      output:
        'Application for React Frontend Engineer\n\nDear Ms Pozzi,\n\nBody.\n\nKind regards,\nJordan Sample',
      templateLanguage: 'en',
    });

    expect(result.missingLetterStructure).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('fails an English letter missing its closing', () => {
    const result = runDeterministicChecks({
      output: 'Application for React Frontend Engineer\n\nDear Ms Pozzi,\n\nBody.\n\nCheers,\nJordan',
      templateLanguage: 'en',
    });

    expect(result.missingLetterStructure).toEqual(['Kind regards']);
    expect(result.pass).toBe(false);
  });

  it('fails a German letter that used the English format', () => {
    const result = runDeterministicChecks({
      output:
        'Application for React Entwickler\n\nDear Frau Pozzi,\n\nText.\n\nKind regards,\nJordan',
      templateLanguage: 'de',
    });

    expect(result.missingLetterStructure).toEqual([
      'Bewerbung als',
      'Hallo or Liebe or Sehr geehrte or Guten Tag',
      'Grüße or Grüßen',
    ]);
    expect(result.pass).toBe(false);
  });

  it('passes the register the sent Anschreiben use', () => {
    // The informal register a sent Anschreiben used. Requiring only the formal pair rejected it.
    const result = runDeterministicChecks({
      output:
        'Bewerbung als Full-Stack Engineer\n\nHallo Jonas und Lumen & Vale-Team,\n\nText.\n\n' +
        'Viele Grüße,\nJordan Sample',
      templateLanguage: 'de',
    });

    expect(result.missingLetterStructure).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('also passes the formal register, for a traditional employer', () => {
    const result = runDeterministicChecks({
      output:
        'Bewerbung als React Entwickler\n\nSehr geehrte Frau Pozzi,\n\nText.\n\n' +
        'Mit freundlichen Grüßen\nJordan Sample',
      templateLanguage: 'de',
    });

    expect(result.missingLetterStructure).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('does not run at all when no language is named', () => {
    const result = runDeterministicChecks({ output: 'A letter in some other shape entirely.' });

    expect(result.missingLetterStructure).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('letter body extraction', () => {
  const LETTERHEAD = [
    'JORDAN SAMPLE',
    'Senior Product Engineer / Full-Stack Engineer',
    'Beispielweg 7, 10115 Berlin  |  +49 176 12345678  |  jordan.sample@example.com',
    'An: Beispiel Digital',
    '18.08.2026',
    'Bewerbung als Senior Full Stack Developer',
    'Beispiel Digital | Fürth',
  ].join('\n');

  it('drops the letterhead, whose digits are contact details rather than claims', () => {
    const letter = `${LETTERHEAD}\nLiebes Beispiel-Team,\nAt Northwind I lifted scores from 75 to 85.`;

    expect(extractLetterBody(letter, 'de')).toBe('At Northwind I lifted scores from 75 to 85.');
  });

  it('stops the postcode and phone number being reported as invented metrics', () => {
    const letter = `${LETTERHEAD}\nLiebes Beispiel-Team,\nAt Northwind I lifted scores from 75 to 85.`;
    const result = runDeterministicChecks({
      output: letter,
      cvText: 'NORTHWIND: Lighthouse scores from 75 to ~85-90+.',
      templateLanguage: 'de',
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('reports the address digits when no language is named and the body cannot be located', () => {
    const letter = `${LETTERHEAD}\nLiebes Beispiel-Team,\nAt Northwind I lifted scores from 75 to 85.`;
    const result = runDeterministicChecks({
      output: letter,
      cvText: 'NORTHWIND: Lighthouse scores from 75 to ~85-90+.',
    });

    // The postcode needs the body scoping to disappear. The phone number does not: it is stripped
    // as contact-shaped text regardless, which is why it is absent here.
    expect(result.unsupportedNumbers).toEqual(expect.arrayContaining(['10115']));
    expect(result.unsupportedNumbers).not.toContain('12345678');
  });

  it('counts words in the body only, which is what the length range refers to', () => {
    const letter = `${LETTERHEAD}\nHallo Team,\nOne two three four five.`;

    expect(runDeterministicChecks({ output: letter, templateLanguage: 'de' }).wordCount).toBe(5);
  });

  it('falls back to the whole text when no salutation is found', () => {
    expect(extractLetterBody('No salutation anywhere in this text.', 'de')).toBe(
      'No salutation anywhere in this text.',
    );
  });
});
