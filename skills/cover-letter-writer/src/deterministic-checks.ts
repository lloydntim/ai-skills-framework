import type { StandardPhrase } from './phrase-bank';
import type { JobPreference } from './preference-bank';
import { REQUIRED_STRUCTURE, SALUTATION_MARKERS, type LetterLanguage } from './templates';

/**
 * Mechanical checks over a drafted cover letter. No model is involved: everything here is settled
 * by looking at the text of the letter and the CV it is supposed to be grounded in. A judge model
 * can be talked round by fluent writing and will score a confident paragraph highly even when it
 * has invented an employer; a substring check cannot.
 */

export interface DeterministicCheckInput {
  output: string;
  /** The CV the letter must be grounded in. Without it, the fabrication checks cannot run. */
  cvText?: string;
  /** The job spec the letter is answering. Without it, the phrase-trigger check cannot run. */
  roleDescription?: string;
  /** The phrase bank, from parsePhraseBank(). Without it, the phrase checks do not run. */
  standardPhrases?: StandardPhrase[];
  /** Opt in to the house-format structural check by naming the letter's language. */
  templateLanguage?: LetterLanguage;
  /** The preference bank, from parsePreferenceBank(). Without it, the preference check does not run. */
  preferences?: JobPreference[];
  requiredExactStrings?: string[];
  /** Groups of alternatives; each group is satisfied by any one of its members appearing. */
  requiredAnyOf?: string[][];
  requiredTerms?: string[];
  forbiddenClaims?: string[];
  /** Defaults to DEFAULT_FORBIDDEN_CHARACTERS. Pass [] to disable. */
  forbiddenCharacters?: string[];
  /** Defaults to TECHNOLOGY_VOCABULARY. Pass [] to disable the technology check. */
  technologyVocabulary?: string[];
  /** Technologies the letter may name because the advert named them, not the candidate's CV. */
  allowedTechnologies?: string[];
  /** Numbers the letter may carry that are quoted from the advert rather than the CV. */
  allowedNumbers?: string[];
  /** Defaults to DEFAULT_CLICHES. Pass [] to disable. */
  cliches?: string[];
  minWords?: number;
  maxWords?: number;
}

export interface DeterministicCheckResult {
  pass: boolean;
  missingExactStrings: string[];
  /** Alternative groups where none of the alternatives appeared, joined for reporting. */
  missingRequiredGroups: string[];
  missingTerms: string[];
  matchedForbiddenClaims: string[];
  matchedForbiddenCharacters: string[];
  unfilledPlaceholders: string[];
  unsupportedTechnologies: string[];
  unsupportedNumbers: string[];
  /** House-format markers the letter should carry but does not. */
  missingLetterStructure: string[];
  /** Phrases from the bank whose CV anchor is absent, so they are not true of this CV. */
  phrasesWithoutCvSupport: string[];
  /** Ids of bank phrases used verbatim. Informational: adapted phrases will not appear here. */
  usedStandardPhrases: string[];
  /** An opening that summarises the advert instead of saying why it appeals. Soft. */
  openingRestatesAdvert: string[];
  /** Phrases used although the spec contains none of their triggers. */
  untriggeredPhrases: string[];
  /** Ids of job preferences stated verbatim. Informational. */
  usedPreferences: string[];
  /** Preferences claimed although the spec never offered them. A false claim about the employer. */
  unofferedPreferences: string[];
  wordCount: number;
  wordCountOutOfRange: boolean;
  matchedCliches: string[];
  repeatedSentenceOpeners: string[];
}

export const DEFAULT_FORBIDDEN_CHARACTERS = ['—', '–'];

/**
 * Phrases that carry no evidence. A letter is not broken for containing one, so these are soft:
 * they signal "rewrite this sentence with the specific thing that made you say it".
 */
export const DEFAULT_CLICHES = [
  'writing to express my interest',
  'proven track record',
  'passionate about technology',
  'perfect fit',
  'hit the ground running',
  'team player',
  'dynamic environment',
  'results-driven',
  'think outside the box',
  'wealth of experience',
  'fast-paced environment',
  'go-getter',
  'self-starter',
  'synergy',
  'value add',
];

/**
 * Used to catch a technology named in the letter that the CV never mentions. Deliberately excludes
 * names that are ordinary words in English or German ("Go", "Rust", "R", "C") because a
 * word-boundary substring check cannot tell the language from the tool for those, and a false
 * accusation of fabrication is worse here than a missed one.
 */
export const TECHNOLOGY_VOCABULARY = [
  'TypeScript', 'JavaScript', 'Python', 'Java', 'Kotlin', 'Swift', 'SwiftUI', 'Objective-C',
  'Ruby', 'PHP', 'Perl', 'Scala', 'Elixir', 'Erlang', 'Haskell', 'Clojure', 'Dart', 'MATLAB',
  'C++', 'C#', '.NET', 'ASP.NET', 'SQL',
  'React', 'React Native', 'Angular', 'AngularJS', 'Vue', 'Vue.js', 'Svelte', 'SvelteKit',
  'SolidJS', 'Ember', 'Backbone', 'Knockout', 'jQuery', 'Next.js', 'Nuxt', 'Remix', 'Gatsby',
  'Astro', 'Preact', 'Alpine.js', 'Stencil.js', 'Web Components', 'Flutter', 'Xamarin', 'Ionic',
  'Redux', 'MobX', 'Zustand', 'Recoil', 'RxJS', 'React Query', 'Apollo',
  'Node.js', 'Express', 'Express.js', 'Fastify', 'Koa', 'Nest.js', 'Deno', 'Bun', 'FastAPI',
  'Django', 'Flask', 'Rails', 'Laravel', 'Spring', 'Spring Boot', 'Hibernate',
  'GraphQL', 'gRPC', 'tRPC', 'REST', 'SOAP', 'OpenAPI', 'WebSockets', 'JWT', 'OAuth',
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Cassandra', 'DynamoDB', 'Elasticsearch',
  'Oracle', 'Snowflake', 'Prisma', 'Sequelize', 'TypeORM', 'Mongoose', 'dbt',
  'Kafka', 'RabbitMQ', 'Spark', 'Hadoop', 'Airflow', 'TensorFlow', 'PyTorch',
  'Docker', 'Kubernetes', 'Helm', 'OpenShift', 'Istio', 'Terraform', 'Ansible', 'Nginx', 'Apache',
  'AWS', 'GCP', 'Google Cloud', 'Azure', 'Firebase', 'Vercel', 'Netlify', 'Heroku', 'Railway',
  'Render', 'Lambda', 'Jenkins', 'CircleCI', 'GitHub Actions', 'GitLab CI/CD', 'Maven', 'Gradle',
  'Webpack', 'Vite', 'Rollup', 'esbuild', 'Babel', 'pnpm', 'Turborepo',
  'Jest', 'Vitest', 'Mocha', 'Jasmine', 'Karma', 'Cypress', 'Playwright', 'Selenium', 'Puppeteer',
  'React Testing Library', 'JUnit', 'Storybook',
  'AEM', 'Contentful', 'Strapi', 'Sanity', 'WordPress', 'Drupal', 'Sitecore', 'Shopify',
  'Magento', 'Salesforce', 'SAP',
  'Tailwind CSS', 'Bootstrap', 'Sass', 'Styled Components', 'HTML5', 'CSS3', 'WCAG', 'Lighthouse',
  'Figma', 'Sketch', 'Balsamiq', 'Three.js', 'D3.js', 'WebGL', 'Unity', 'Unreal',
  'Sentry', 'PostHog', 'Google Analytics', 'Camunda', 'Temporal',
  // Target platforms. A claim to have shipped on one is exactly as checkable as a claim to
  // have used a framework, and just as easy to add by accident when a spec asks for it.
  // "Windows" is left out: a frontend letter says "windows" about browsers.
  'Android', 'iOS', 'macOS', 'watchOS', 'Linux',
];

/**
 * Folds German umlauts and eszett to their transcribed forms, so "Gründer" and "Gruender" match
 * each other. Job specs are written both ways, often within one document, and a signal that only
 * carries the umlaut form silently fails on half of them.
 */
function foldGerman(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/**
 * Word-boundary-aware, case-insensitive containment. Uses index scanning rather than a regex so
 * that terms carrying regex metacharacters ("Node.js", "C++", ".NET") need no escaping. The
 * boundary test is what stops "Java" matching inside "JavaScript".
 */
function containsTerm(text: string, term: string): boolean {
  const haystack = foldGerman(text);
  const needle = foldGerman(term);
  if (needle.length === 0) return false;

  const isWordChar = (c: string) => c.length > 0 && /[a-z0-9]/.test(c);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = at + needle.length >= haystack.length ? '' : haystack[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/**
 * Like containsTerm, but tolerates the inflected forms a job advert actually uses. A spec asking
 * for someone to work with "product managers" and "designers" must match the signals "product
 * manager" and "designer": the strict boundary check rejects both, because the next character is
 * the plural "s". That silently blocked a correct letter.
 *
 * Kept separate from containsTerm on purpose. Technology names need the strict form, or "React"
 * would match "reacts" and "Java" would match "Javas". Only triggers and signals use this.
 */
const INFLECTIONS = ['', 's', 'es', 'n', 'en', 'ern', 'e', 'r'];

function containsSignal(text: string, term: string): boolean {
  const haystack = foldGerman(text);
  const needle = foldGerman(term);
  if (needle.length === 0) return false;

  const isWordChar = (c: string) => c.length > 0 && /[a-z0-9]/.test(c);
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    if (!isWordChar(before)) {
      for (const suffix of INFLECTIONS) {
        const end = at + needle.length + suffix.length;
        if (haystack.slice(at + needle.length, end) !== suffix) continue;
        const after = end >= haystack.length ? '' : haystack[end];
        if (!isWordChar(after)) return true;
      }
    }
    from = at + 1;
  }
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return foldGerman(haystack).includes(foldGerman(needle));
}

/**
 * Numeric tokens, normalised so "~85-90+" and "85 to 90" both yield ["85", "90"].
 *
 * Four-digit years (1900-2099) are deliberately excluded. A letter legitimately carries a date,
 * and CV role periods put years everywhere, so including them produced false fabrication reports
 * without catching anything: an invented employment period is caught by the employer and duration
 * rules instead, not by an unfamiliar year.
 */
function extractNumbers(text: string): string[] {
  // Contact details are not claims. URLs, email addresses and phone numbers are stripped first,
  // because a signature block reading "T: +49 176 12345678" otherwise reports three invented
  // metrics on every letter that carries one.
  const withoutContacts = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\+\d[\d\s()-]{6,}/g, ' ');

  // The lookbehind stops digits inside a name being read as a number of their own: "PREIS24" is a
  // company, not a claim to have done something twenty-four times.
  const matches = withoutContacts.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)*\s*%?/gu) ?? [];
  const numbers: string[] = [];
  for (const raw of matches) {
    const token = raw.replace(/\s+/g, '');
    const digits = token.replace(/%$/, '');
    const value = Number(digits.replace(/,/g, ''));
    const isYear = /^\d{4}$/.test(digits) && value >= 1900 && value <= 2099;
    if (isYear) continue;
    numbers.push(token);
  }
  return numbers;
}

/**
 * Template slots the model failed to fill. A letter that goes out carrying "[Company Name]" is a
 * catastrophic and entirely preventable failure, which is why this is hard rather than soft.
 * Markdown links are excluded: "[text](url)" is a link, not an unfilled slot.
 */
function findPlaceholders(text: string): string[] {
  const found: string[] = [];

  const bracketed = /\[([^\][\n]{1,60})\]/g;
  for (const match of text.matchAll(bracketed)) {
    const endsAt = (match.index ?? 0) + match[0].length;
    if (text[endsAt] === '(') continue;
    found.push(match[0]);
  }

  for (const pattern of [/\{\{[^}\n]{1,60}\}\}/g, /<[^>\n]{1,60}>/g]) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }

  for (const match of text.matchAll(/\b(?:TODO|TBD|INSERT|FIXME|X{3,})\b/gi)) {
    found.push(match[0]);
  }

  return found;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/** Openings that are the candidate's own voice rather than monotony. See below. */
const FIRST_PERSON_OPENERS = new Set(['i', 'my', 'ich', 'mein', 'meine']);

/**
 * Flags an opening that narrates the company back at them.
 *
 * "Agile Robots is building a web platform ..." and "Atolls describes a community-driven shopping
 * platform ..." both summarise the advert before saying anything, and both were rejected on sight.
 * The sent letters do the opposite: they name the thing and give the reason in the same breath,
 * as in "The osapiens HUB appeals to me because compliance is genuinely hard software". Only the
 * first sentence is inspected, because this is a rule about how a letter opens.
 */
function findOpeningThatRestatesTheAdvert(text: string): string[] {
  const first = text.split(/(?<=[.!?])\s+/)[0]?.trim();
  if (!first) return [];

  const match = first.match(
    /^((?:[A-Z][\w.&'-]*)(?:\s+(?:[A-Z][\w.&'-]*|of|and|for|the))??(?:\s+[A-Z][\w.&'-]*)?)\s+(is|are|was|were|has|have|describes|offers|provides|builds|develops|operates|runs|makes)\b/,
  );
  if (!match) return [];

  return [`${match[1]} ${match[2]}`];
}

/**
 * Flags an opening word used so often it reads as monotony. Only from four sentences up, so a
 * short note is never penalised for two sentences that start alike, and never for first person.
 */
function findRepeatedSentenceOpeners(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length < 4) return [];

  const openers = new Map<string, number>();
  for (const sentence of sentences) {
    const match = sentence.match(/^\p{L}+/u);
    if (!match) continue;
    const opener = match[0].toLowerCase();
    // First-person openings are exempt. Measured across the sent letters, "I" opens 27% and 44%
    // of sentences, so flagging it told the candidate to sound less like themselves. Repetition of
    // any other word still reads as monotony: three sentences starting "At" is worth fixing.
    if (FIRST_PERSON_OPENERS.has(opener)) continue;
    openers.set(opener, (openers.get(opener) ?? 0) + 1);
  }

  return [...openers.entries()].filter(([, count]) => count > 2).map(([opener]) => opener);
}

/**
 * Everything from the salutation onward. The letterhead above it carries the postcode, phone number
 * and date, which are not claims about experience: checking them reported the postcode and phone digits
 * as fabricated metrics on every letter. Falls back to the whole text when no language is named or
 * no salutation is found, so the checks never silently inspect nothing.
 */
export function extractLetterBody(text: string, language?: LetterLanguage): string {
  if (!language) return text;

  let earliest = -1;
  const haystack = text.toLowerCase();
  for (const marker of SALUTATION_MARKERS[language]) {
    const at = haystack.indexOf(marker.toLowerCase());
    if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at;
  }
  if (earliest === -1) return text;

  const lineEnd = text.indexOf('\n', earliest);
  return lineEnd === -1 ? text.slice(earliest) : text.slice(lineEnd + 1);
}

export function runDeterministicChecks(input: DeterministicCheckInput): DeterministicCheckResult {
  const requiredExactStrings = input.requiredExactStrings ?? [];
  const requiredTerms = input.requiredTerms ?? [];
  const forbiddenClaims = input.forbiddenClaims ?? [];
  const forbiddenCharacters = input.forbiddenCharacters ?? DEFAULT_FORBIDDEN_CHARACTERS;
  const technologyVocabulary = input.technologyVocabulary ?? TECHNOLOGY_VOCABULARY;
  const allowedTechnologies = input.allowedTechnologies ?? [];
  const allowedNumbers = input.allowedNumbers ?? [];
  const cliches = input.cliches ?? DEFAULT_CLICHES;

  // Claims about experience live in the body; the letterhead above the salutation does not.
  const body = extractLetterBody(input.output, input.templateLanguage);

  const missingExactStrings = requiredExactStrings.filter((s) => !input.output.includes(s));
  const missingRequiredGroups = (input.requiredAnyOf ?? [])
    .filter((group) => !group.some((option) => containsCaseInsensitive(input.output, option)))
    .map((group) => group.join(' or '));
  const missingTerms = requiredTerms.filter((t) => !containsCaseInsensitive(input.output, t));
  const matchedForbiddenClaims = forbiddenClaims.filter((c) =>
    containsCaseInsensitive(input.output, c),
  );
  const matchedForbiddenCharacters = forbiddenCharacters.filter((c) => input.output.includes(c));
  const unfilledPlaceholders = findPlaceholders(input.output);

  // The fabrication checks compare the letter against the CV, so they only run when a CV is given.
  // Reporting every technology as unsupported when no CV was supplied would be noise, not a finding.
  let unsupportedTechnologies: string[] = [];
  let unsupportedNumbers: string[] = [];

  if (input.cvText && input.cvText.length > 0) {
    unsupportedTechnologies = technologyVocabulary.filter(
      (tech) =>
        containsTerm(body, tech) &&
        !containsTerm(input.cvText as string, tech) &&
        !allowedTechnologies.some((allowed) => allowed.toLowerCase() === tech.toLowerCase()),
    );

    // Index each CV number both as written and with any trailing "%" stripped, so a CV reading
    // "~70%" still supports a letter that says "70" (and vice versa, handled on the lookup side).
    const cvNumbers = new Set<string>();
    for (const number of extractNumbers(input.cvText)) {
      cvNumbers.add(number);
      cvNumbers.add(number.replace(/%$/, ''));
    }
    const allowed = new Set(allowedNumbers.map((n) => n.replace(/\s+/g, '')));
    unsupportedNumbers = [
      ...new Set(
        extractNumbers(body).filter(
          (n) => !cvNumbers.has(n) && !allowed.has(n) && !cvNumbers.has(n.replace(/%$/, '')),
        ),
      ),
    ];
  }

  // Phrase-bank checks. A phrase is matched verbatim on purpose: the skill tells the model to
  // adapt phrases to the spec, and an adapted phrase is the desired outcome, not a finding. What
  // is worth catching is the unadapted paste, which is also the case most likely to be off-target.
  const standardPhrases = input.standardPhrases ?? [];
  // Either language counts as "used": a German letter carrying the approved German wording is the
  // same phrase as the English one, and must be gated by the same spec triggers.
  const usedPhrases = standardPhrases.filter(
    (p) =>
      containsCaseInsensitive(input.output, p.phrase) ||
      (p.phraseDe !== undefined && containsCaseInsensitive(input.output, p.phraseDe)),
  );
  const usedStandardPhrases = usedPhrases.map((p) => p.id);

  const phrasesWithoutCvSupport =
    input.cvText && input.cvText.length > 0
      ? usedPhrases
          .filter((p) => p.cvAnchor.length > 0 && !containsTerm(input.cvText as string, p.cvAnchor))
          .map((p) => p.id)
      : [];

  const untriggeredPhrases =
    input.roleDescription && input.roleDescription.length > 0
      ? usedPhrases
          .filter(
            (p) =>
              p.triggers.length > 0 &&
              !p.triggers.some((t) => containsSignal(input.roleDescription as string, t)),
          )
          .map((p) => p.id)
      : [];

  // A preference names something the employer supposedly offers, so unlike a standard phrase it
  // cannot be graded as a relevance miss: crediting an employer with a benefit their advert never
  // mentioned is a false claim about them, and fails outright. Matched verbatim for the same reason
  // phrases are: an adapted sentence is the desired outcome, and the unadapted paste is what is
  // most likely to be wrong about the reader.
  const preferences = input.preferences ?? [];
  const usedPreferenceEntries = preferences.filter(
    (pref) =>
      containsCaseInsensitive(input.output, pref.sentence) ||
      (pref.sentenceDe !== undefined && containsCaseInsensitive(input.output, pref.sentenceDe)),
  );
  const usedPreferences = usedPreferenceEntries.map((pref) => pref.id);

  const unofferedPreferences =
    input.roleDescription && input.roleDescription.length > 0
      ? usedPreferenceEntries
          .filter(
            (pref) =>
              pref.signals.length > 0 &&
              !pref.signals.some((signal) =>
                containsSignal(input.roleDescription as string, signal),
              ),
          )
          .map((pref) => pref.id)
      : [];

  // Only runs when a language is named, so a deliberate one-off format is not reported as broken.
  const missingLetterStructure = input.templateLanguage
    ? REQUIRED_STRUCTURE[input.templateLanguage]
        .filter((group) => !group.some((marker) => containsCaseInsensitive(input.output, marker)))
        .map((group) => group.join(' or '))
    : [];

  const wordCount = countWords(body);
  const belowMin = input.minWords !== undefined && wordCount < input.minWords;
  const aboveMax = input.maxWords !== undefined && wordCount > input.maxWords;
  const matchedCliches = cliches.filter((c) => containsCaseInsensitive(input.output, c));
  const repeatedSentenceOpeners = findRepeatedSentenceOpeners(body);
  const openingRestatesAdvert = findOpeningThatRestatesTheAdvert(body);

  return {
    // Two tiers, as the skill's own rules are written in two tiers. Length, cliches and repeated
    // openers are quality concerns: they should trigger a rewrite of a sentence, not block a
    // letter, and quality signals that block get ignored. Everything above them is a fabrication
    // or a rule that is absolute, so it fails the check outright.
    pass:
      missingExactStrings.length === 0 &&
      missingRequiredGroups.length === 0 &&
      missingTerms.length === 0 &&
      matchedForbiddenClaims.length === 0 &&
      matchedForbiddenCharacters.length === 0 &&
      unfilledPlaceholders.length === 0 &&
      unsupportedTechnologies.length === 0 &&
      unsupportedNumbers.length === 0 &&
      phrasesWithoutCvSupport.length === 0 &&
      missingLetterStructure.length === 0 &&
      unofferedPreferences.length === 0,
    missingExactStrings,
    missingRequiredGroups,
    missingTerms,
    matchedForbiddenClaims,
    matchedForbiddenCharacters,
    unfilledPlaceholders,
    unsupportedTechnologies,
    unsupportedNumbers,
    missingLetterStructure,
    openingRestatesAdvert,
    phrasesWithoutCvSupport,
    usedStandardPhrases,
    untriggeredPhrases,
    usedPreferences,
    unofferedPreferences,
    wordCount,
    wordCountOutOfRange: belowMin || aboveMax,
    matchedCliches,
    repeatedSentenceOpeners,
  };
}
