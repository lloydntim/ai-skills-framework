import { describe, expect, it } from 'vitest';
import { DEFAULT_CLICHES, runDeterministicChecks } from './deterministic-checks';

/**
 * Shaped like the CVs this skill writes letters from, so the checks are exercised against the kind
 * of text they will actually see: mixed prose and stack lists, approximate metrics, and carefully
 * calibrated ownership wording. The employers are fictional.
 */
const CV = `NORTHWIND Zurich, remote | Jul 2024 - Jun 2025
Frontend Architect (Contract)
Evaluated multiple frontend frameworks and architectural approaches, including Next.js and Web
Components. Established React with Vite as the basis for the new frontend architecture, improving
the website's Lighthouse performance scores from 75 to ~85-90+ while preserving SEO capabilities.
Stack: React, TypeScript, Node.js, Java, AEM, Vite SSR, AWS Lambda, GitLab CI/CD, Lighthouse.

TAILSPIN INC London, remote | Mar 2022 - Oct 2022
Product Engineer (Contract)
Helped take a crypto gaming wallet from early development to beta release, delivering the product
for both mobile and web. Built the React Native iOS and web wallet across ~20 screens.
Stack: React Native, TypeScript, Swift, SwiftUI, Python, FastAPI, PostgreSQL, SQL, Git.

ADATUM - CLIENT: LITWARE Wiesbaden, remote | Oct 2023 - Mar 2024
Introduced Jest, linting and component standards, increasing frontend test coverage from near zero
to ~70% and making defects easier to isolate.`;

describe('required exact strings', () => {
  it('passes when every required string appears verbatim', () => {
    const result = runDeterministicChecks({
      output: 'I am applying for the Frontend Architect role at Northwind.',
      requiredExactStrings: ['Frontend Architect', 'Northwind'],
    });

    expect(result.missingExactStrings).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('reports a required string that is absent', () => {
    const result = runDeterministicChecks({
      output: 'I am applying for the advertised role.',
      requiredExactStrings: ['Northwind'],
    });

    expect(result.missingExactStrings).toEqual(['Northwind']);
    expect(result.pass).toBe(false);
  });

  it('is case-sensitive, so a misspelt company name counts as missing', () => {
    const result = runDeterministicChecks({
      output: 'I am applying to NORTHWIND.',
      requiredExactStrings: ['Northwind'],
    });

    expect(result.missingExactStrings).toEqual(['Northwind']);
  });
});

describe('required terms', () => {
  it('matches regardless of capitalisation', () => {
    const result = runDeterministicChecks({
      output: 'My focus has been react and typescript.',
      requiredTerms: ['React', 'TypeScript'],
    });

    expect(result.missingTerms).toEqual([]);
  });

  it('reports a term that is absent in any casing', () => {
    const result = runDeterministicChecks({
      output: 'My focus has been on frontend work.',
      requiredTerms: ['React'],
    });

    expect(result.missingTerms).toEqual(['React']);
    expect(result.pass).toBe(false);
  });
});

describe('forbidden claims', () => {
  it('flags an upgraded ownership claim regardless of capitalisation', () => {
    const result = runDeterministicChecks({
      output: 'At Tailspin Inc I Led The Launch of a crypto gaming wallet.',
      forbiddenClaims: ['led the launch'],
    });

    expect(result.matchedForbiddenClaims).toEqual(['led the launch']);
    expect(result.pass).toBe(false);
  });

  it('passes when the letter keeps the CV ownership level', () => {
    const result = runDeterministicChecks({
      output: 'At Tailspin Inc I helped take a crypto gaming wallet to beta release.',
      forbiddenClaims: ['led the launch', 'single-handedly'],
    });

    expect(result.matchedForbiddenClaims).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('forbidden characters', () => {
  it('flags an em dash without the caller having to ask for it', () => {
    const result = runDeterministicChecks({
      output: 'I led the architecture work — and delivered it on time.',
    });

    expect(result.matchedForbiddenCharacters).toEqual(['—']);
    expect(result.pass).toBe(false);
  });

  it('flags an en dash, including in a numeric range', () => {
    const result = runDeterministicChecks({ output: 'Scores rose from 75 to 85–90.' });

    expect(result.matchedForbiddenCharacters).toEqual(['–']);
  });

  it('accepts a plain hyphen for a range', () => {
    const result = runDeterministicChecks({ output: 'Scores rose from 75 to 85-90.' });

    expect(result.matchedForbiddenCharacters).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('can be disabled with an explicit empty list', () => {
    const result = runDeterministicChecks({
      output: 'I led the work — and shipped it.',
      forbiddenCharacters: [],
    });

    expect(result.matchedForbiddenCharacters).toEqual([]);
  });
});

describe('unfilled placeholders', () => {
  it('flags a square-bracket slot left in the letter', () => {
    const result = runDeterministicChecks({
      output: 'I am applying for the [Role Title] position at [Company Name].',
    });

    expect(result.unfilledPlaceholders).toEqual(['[Role Title]', '[Company Name]']);
    expect(result.pass).toBe(false);
  });

  it('flags handlebars and angle-bracket slots', () => {
    const result = runDeterministicChecks({
      output: 'Dear {{hiring_manager}}, I am applying to <company>.',
    });

    expect(result.unfilledPlaceholders).toEqual(['{{hiring_manager}}', '<company>']);
  });

  it('flags leftover editing markers', () => {
    const result = runDeterministicChecks({ output: 'Availability: TBD. Salary: TODO.' });

    expect(result.unfilledPlaceholders).toEqual(['TBD', 'TODO']);
  });

  it('does not mistake a markdown link for an unfilled slot', () => {
    const result = runDeterministicChecks({
      output: 'My work is at [github.com/jordan-sample-example](https://github.com/jordan-sample-example).',
    });

    expect(result.unfilledPlaceholders).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('unsupported technologies', () => {
  it('flags a technology the CV never mentions', () => {
    const result = runDeterministicChecks({
      output: 'I have built production interfaces in React and Svelte.',
      cvText: CV,
    });

    expect(result.unsupportedTechnologies).toEqual(['Svelte']);
    expect(result.pass).toBe(false);
  });

  it('accepts technologies the CV does evidence', () => {
    const result = runDeterministicChecks({
      output: 'I have built production interfaces in React, TypeScript and React Native.',
      cvText: CV,
    });

    expect(result.unsupportedTechnologies).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('does not read a shorter technology name out of a longer one', () => {
    const result = runDeterministicChecks({
      output: 'I work primarily in JavaScript.',
      cvText: 'Stack: TypeScript, React, Node.js.',
    });

    // "Java" is a substring of "JavaScript" and is absent from this CV, but it was never claimed,
    // so reporting it would be a false accusation of fabrication. Only the real one is reported.
    expect(result.unsupportedTechnologies).toEqual(['JavaScript']);
  });

  it('does not read a technology out of an ordinary English word', () => {
    const result = runDeterministicChecks({
      output: 'The role sparked my interest immediately.',
      cvText: CV,
    });

    // "sparked" contains Spark and "interest" contains REST. Neither is a claim.
    expect(result.unsupportedTechnologies).toEqual([]);
  });

  it('allows a technology the letter attributes to the advert', () => {
    const result = runDeterministicChecks({
      output: 'Your team works in Svelte, and my component work transfers directly.',
      cvText: CV,
      allowedTechnologies: ['Svelte'],
    });

    expect(result.unsupportedTechnologies).toEqual([]);
  });

  it('skips the check entirely when no CV is supplied', () => {
    const result = runDeterministicChecks({ output: 'I have deep Svelte and Terraform experience.' });

    expect(result.unsupportedTechnologies).toEqual([]);
    expect(result.pass).toBe(true);
  });
});

describe('unsupported numbers', () => {
  it('flags a metric that appears nowhere in the CV', () => {
    const result = runDeterministicChecks({
      output: 'I improved site performance by 40%.',
      cvText: CV,
    });

    expect(result.unsupportedNumbers).toEqual(['40%']);
    expect(result.pass).toBe(false);
  });

  it('accepts a metric quoted accurately from the CV', () => {
    const result = runDeterministicChecks({
      output: 'Lighthouse scores rose from 75 to 85-90 across the platform.',
      cvText: CV,
    });

    expect(result.unsupportedNumbers).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('accepts a bare number where the CV writes it with a percent sign', () => {
    const result = runDeterministicChecks({
      output: 'Test coverage reached roughly 70 percent.',
      cvText: CV,
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('ignores four-digit years, which a letter legitimately carries as a date', () => {
    const result = runDeterministicChecks({
      output: 'Since 2016 my focus has been React.',
      cvText: CV,
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('allows a number the letter quotes from the advert', () => {
    const result = runDeterministicChecks({
      output: 'Supporting all 12 of your European markets is familiar ground.',
      cvText: CV,
      allowedNumbers: ['12'],
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('reports each unsupported number once, however often it is repeated', () => {
    const result = runDeterministicChecks({
      output: 'I managed 40 engineers. Leading 40 engineers taught me a lot.',
      cvText: CV,
    });

    expect(result.unsupportedNumbers).toEqual(['40']);
  });
});

describe('soft signals do not fail the check', () => {
  it('reports an over-length letter without failing it', () => {
    const result = runDeterministicChecks({
      output: 'word '.repeat(500),
      minWords: 250,
      maxWords: 400,
    });

    expect(result.wordCount).toBe(500);
    expect(result.wordCountOutOfRange).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('reports an under-length letter without failing it', () => {
    const result = runDeterministicChecks({ output: 'Too short.', minWords: 250 });

    expect(result.wordCountOutOfRange).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('reports cliches without failing the letter', () => {
    const result = runDeterministicChecks({
      output: 'I am writing to express my interest. I have a proven track record.',
    });

    expect(result.matchedCliches).toEqual([
      'writing to express my interest',
      'proven track record',
    ]);
    expect(result.pass).toBe(true);
  });

  it('reports a sentence opener used more than twice', () => {
    const result = runDeterministicChecks({
      output: 'At Northwind I led it. At Fabrikam I built it. At Adatum I shipped it. The team grew.',
    });

    expect(result.repeatedSentenceOpeners).toEqual(['at']);
    expect(result.pass).toBe(true);
  });

  it('never flags "I", which is the candidate\'s own voice rather than monotony', () => {
    // Measured across the sent letters, "I" opens 27% and 44% of sentences. An earlier version
    // flagged it, and following that advice produced a letter that did not sound like the
    // candidate at all: 6% of sentences opened with "I".
    const result = runDeterministicChecks({
      output: 'I led the work. I built the system. I shipped it. I would welcome a conversation.',
    });

    expect(result.repeatedSentenceOpeners).toEqual([]);
  });

  it('never flags "My" either, which is the same voice in possessive form', () => {
    const result = runDeterministicChecks({
      output: 'My work extends beyond code. My background is broad. My focus is React. It shows.',
    });

    expect(result.repeatedSentenceOpeners).toEqual([]);
  });

  it('still flags a non-first-person opener even when "I" dominates the letter', () => {
    const result = runDeterministicChecks({
      output:
        'I led the work. At Northwind it shipped. At Fabrikam it scaled. At Adatum it held. I would welcome a chat.',
    });

    expect(result.repeatedSentenceOpeners).toEqual(['at']);
  });

  it('does not flag repeated openers in a note of fewer than four sentences', () => {
    const result = runDeterministicChecks({
      output: 'At Northwind I led it. At Fabrikam I built it. At Adatum I shipped it.',
    });

    expect(result.repeatedSentenceOpeners).toEqual([]);
  });

  it('does not flag an opener used exactly twice', () => {
    const result = runDeterministicChecks({
      output: 'At Northwind I led it. At Fabrikam I built it. The team grew. Delivery improved.',
    });

    expect(result.repeatedSentenceOpeners).toEqual([]);
  });
});

describe('the pass flag', () => {
  it('is true for a letter that breaks no hard rule', () => {
    const result = runDeterministicChecks({
      output:
        'At Northwind I established a React and Vite frontend architecture, lifting Lighthouse ' +
        'scores from 75 to 85-90 while preserving SEO. At Tailspin Inc I helped take a crypto ' +
        'gaming wallet to beta release across roughly 20 screens.',
      cvText: CV,
      requiredExactStrings: ['Northwind'],
      requiredTerms: ['React'],
      forbiddenClaims: ['led the launch'],
    });

    expect(result.pass).toBe(true);
  });

  it('is false when any single hard rule breaks, with the others still clean', () => {
    const result = runDeterministicChecks({
      output: 'At Northwind I worked in React and Svelte.',
      cvText: CV,
      requiredExactStrings: ['Northwind'],
      requiredTerms: ['React'],
    });

    expect(result.missingExactStrings).toEqual([]);
    expect(result.missingTerms).toEqual([]);
    expect(result.unsupportedTechnologies).toEqual(['Svelte']);
    expect(result.pass).toBe(false);
  });

  it('exposes the default cliche list so callers can extend rather than retype it', () => {
    expect(DEFAULT_CLICHES).toContain('proven track record');
  });
});

describe('standard phrases', () => {
  const BANK = [
    {
      id: 'performance-seo',
      triggers: ['performance', 'Lighthouse', 'SEO'],
      phrase: 'At Northwind I established a React and Vite frontend architecture.',
      cvAnchor: 'Northwind',
    },
    {
      id: 'testing-quality',
      triggers: ['testing', 'test coverage', 'quality'],
      phrase: 'At Adatum I introduced Jest, linting and component standards.',
      cvAnchor: 'Adatum',
    },
  ];

  it('records a phrase used verbatim', () => {
    const result = runDeterministicChecks({
      output: `Hello. ${BANK[0].phrase} Regards.`,
      cvText: CV,
      roleDescription: 'We care about Lighthouse scores above all.',
      standardPhrases: BANK,
    });

    expect(result.usedStandardPhrases).toEqual(['performance-seo']);
    expect(result.untriggeredPhrases).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('flags a phrase used although the spec contains none of its triggers', () => {
    const result = runDeterministicChecks({
      output: `Hello. ${BANK[1].phrase} Regards.`,
      cvText: CV,
      roleDescription: 'We are hiring a designer to run our brand refresh.',
      standardPhrases: BANK,
    });

    expect(result.untriggeredPhrases).toEqual(['testing-quality']);
  });

  it('treats an off-target phrase as soft, because it is a relevance miss not a lie', () => {
    const result = runDeterministicChecks({
      output: `Hello. ${BANK[1].phrase} Regards.`,
      cvText: CV,
      roleDescription: 'We are hiring a designer to run our brand refresh.',
      standardPhrases: BANK,
    });

    expect(result.untriggeredPhrases).toEqual(['testing-quality']);
    expect(result.pass).toBe(true);
  });

  it('fails a phrase whose CV anchor is absent, because it is not true of this CV', () => {
    // This CV carries Jest but never Adatum, so the anchor is the only thing that can fail here.
    // With "Jest" absent from the CV the technology check would fail it too, and the test would
    // then pass whether or not the anchor rule existed at all.
    const result = runDeterministicChecks({
      output: `Hello. ${BANK[1].phrase} Regards.`,
      cvText: 'NORTHWIND only. Stack: React, TypeScript, Jest.',
      roleDescription: 'We care deeply about test coverage.',
      standardPhrases: BANK,
    });

    expect(result.unsupportedTechnologies).toEqual([]);
    expect(result.phrasesWithoutCvSupport).toEqual(['testing-quality']);
    expect(result.pass).toBe(false);
  });

  it('does not report a phrase the model adapted, which is the desired outcome', () => {
    const result = runDeterministicChecks({
      output: 'At Northwind I established the React and Vite architecture your migration needs.',
      cvText: CV,
      roleDescription: 'A performance-focused migration.',
      standardPhrases: BANK,
    });

    expect(result.usedStandardPhrases).toEqual([]);
    expect(result.untriggeredPhrases).toEqual([]);
  });

  it('skips the trigger check when no spec is supplied', () => {
    const result = runDeterministicChecks({
      output: `Hello. ${BANK[1].phrase} Regards.`,
      cvText: CV,
      standardPhrases: BANK,
    });

    expect(result.usedStandardPhrases).toEqual(['testing-quality']);
    expect(result.untriggeredPhrases).toEqual([]);
  });

  it('reports nothing when no phrase bank is supplied', () => {
    const result = runDeterministicChecks({ output: BANK[0].phrase, cvText: CV });

    expect(result.usedStandardPhrases).toEqual([]);
    expect(result.phrasesWithoutCvSupport).toEqual([]);
  });
});

describe('platform claims', () => {
  it('flags a platform the CV never shipped on', () => {
    // Taken from a real sent letter: "building across iOS, Android and web" against a CV that
    // says "React Native iOS and web wallet". The iOS claim is sound; Android is not.
    const result = runDeterministicChecks({
      output: 'At Tailspin I built across iOS, Android and web.',
      cvText: 'TAILSPIN INC: Built the React Native iOS and web wallet across ~20 screens.',
    });

    expect(result.unsupportedTechnologies).toEqual(['Android']);
    expect(result.pass).toBe(false);
  });

  it('does not read the iOS platform out of an ordinary word', () => {
    const result = runDeterministicChecks({
      output: 'I weigh ratios and scenarios before committing to an approach.',
      cvText: 'Stack: React, TypeScript.',
    });

    expect(result.unsupportedTechnologies).toEqual([]);
  });
});

describe('contact details are not claims', () => {
  it('does not read digits inside a company name as a metric', () => {
    // From a sent letter, which reported "24" as an invented number.
    const result = runDeterministicChecks({
      output: 'I am applying to PREIS24 because the product interests me.',
      cvText: 'Stack: React, TypeScript.',
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('ignores a phone number in a signature block', () => {
    const result = runDeterministicChecks({
      output: 'Viele Grüße,\nJordan Sample\nT: +49 176 12345678',
      cvText: 'Stack: React.',
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('ignores digits inside a URL or an email address', () => {
    const result = runDeterministicChecks({
      output: 'See https://example.com/v2/profile?id=9912 or write to jordan99@example.com.',
      cvText: 'Stack: React.',
    });

    expect(result.unsupportedNumbers).toEqual([]);
  });

  it('still catches a real invented metric alongside contact details', () => {
    const result = runDeterministicChecks({
      output: 'I improved conversion by 42%.\n\nViele Grüße,\nJordan\nT: +49 176 12345678',
      cvText: 'Stack: React.',
    });

    expect(result.unsupportedNumbers).toEqual(['42%']);
  });
});

describe('inflection tolerance is scoped to signals, not technologies', () => {
  it('does not let "reacts" vouch for the React framework', () => {
    // containsSignal tolerates a trailing "s"; the technology check must not, or ordinary English
    // verbs would count as framework experience.
    const result = runDeterministicChecks({
      output: 'The system reacts to every change immediately.',
      cvText: 'Stack: TypeScript, Node.js.',
    });

    expect(result.unsupportedTechnologies).toEqual([]);
  });
});

describe('an opening that restates the advert', () => {
  // Both of these were written and both were rejected on sight by the candidate, for the same
  // reason: they summarise the company before saying anything about him.
  it('flags the Agile Robots opening', () => {
    const result = runDeterministicChecks({
      output:
        'Agile Robots is building a web platform to orchestrate robotic systems, and that is the work that appeals to me.',
    });

    expect(result.openingRestatesAdvert).toEqual(['Agile Robots is']);
    expect(result.pass).toBe(true);
  });

  it('flags the Atolls opening', () => {
    const result = runDeterministicChecks({
      output: 'Atolls describes a community-driven shopping platform active in many markets.',
    });

    expect(result.openingRestatesAdvert).toEqual(['Atolls describes']);
  });

  it('leaves the sent letters alone, which name the thing and give the reason at once', () => {
    const result = runDeterministicChecks({
      output:
        'The osapiens HUB appeals to me because compliance is genuinely hard software: intricate rules that keep changing.',
    });

    expect(result.openingRestatesAdvert).toEqual([]);
  });

  it('does not flag a first-person opening', () => {
    const result = runDeterministicChecks({
      output: 'I bring 15 years of engineering experience, most of it in TypeScript.',
    });

    expect(result.openingRestatesAdvert).toEqual([]);
  });

  it('is soft: it never fails the letter on its own', () => {
    const result = runDeterministicChecks({
      output: 'Agile Robots is building a platform.',
    });

    expect(result.openingRestatesAdvert.length).toBe(1);
    expect(result.pass).toBe(true);
  });
});
