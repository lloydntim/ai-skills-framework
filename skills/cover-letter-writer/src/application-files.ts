/**
 * Where an application's two documents are saved, and what they are called.
 *
 * The naming is mechanical, so it belongs in code with tests rather than in prose the model has to
 * reproduce from memory. A letter filed under the wrong company or a misspelled country is not a
 * writing mistake that a reader notices, it is a document nobody finds again.
 */
import os from 'node:os';
import path from 'node:path';

/**
 * The company name as a folder: lowercase, punctuation dropped, spaces joined with hyphens.
 *
 * Dots and apostrophes are removed rather than turned into separators, so "Nord.Energie" files as "nordenergie"
 * and not "e-on". Anything else that is not a letter or digit becomes a single hyphen.
 */
export function slugifyCompany(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Country codes used for the folder level. "uk" rather than the ISO "gb", to stay in the same
 * vocabulary as markets.ts, which the letter's contact block already uses.
 */
const LOCATION_COUNTRIES: Record<string, string> = {
  germany: 'de', deutschland: 'de', munich: 'de', münchen: 'de', berlin: 'de', hamburg: 'de',
  frankfurt: 'de', cologne: 'de', köln: 'de', stuttgart: 'de', düsseldorf: 'de', essen: 'de',
  bremen: 'de', bremerhaven: 'de', leipzig: 'de', dresden: 'de', nuremberg: 'de', nürnberg: 'de',
  austria: 'at', österreich: 'at', vienna: 'at', wien: 'at', graz: 'at', linz: 'at',
  switzerland: 'ch', schweiz: 'ch', zurich: 'ch', zürich: 'ch', geneva: 'ch', basel: 'ch', bern: 'ch',
  'united kingdom': 'uk', uk: 'uk', england: 'uk', scotland: 'uk', wales: 'uk', london: 'uk',
  manchester: 'uk', edinburgh: 'uk', bristol: 'uk', leeds: 'uk', glasgow: 'uk', cambridge: 'uk',
  ireland: 'ie', dublin: 'ie', cork: 'ie', galway: 'ie',
  netherlands: 'nl', amsterdam: 'nl', rotterdam: 'nl', utrecht: 'nl',
  spain: 'es', madrid: 'es', barcelona: 'es', valencia: 'es',
  france: 'fr', paris: 'fr', lyon: 'fr',
  portugal: 'pt', lisbon: 'pt', porto: 'pt',
  poland: 'pl', warsaw: 'pl', krakow: 'pl',
  'united states': 'us', usa: 'us', 'new york': 'us', 'san francisco': 'us',
};

/**
 * The country folder for a role, decided from the advert's location and falling back to its
 * language.
 *
 * Returns undefined when neither settles it. That is deliberate: the skill's rule against guessing
 * applies to a file path as much as to a sentence, and a wrong country silently splits one
 * company's applications across two trees.
 */
export function countryCodeFor(spec: { location?: string; language?: string }): string | undefined {
  const haystack = (spec.location ?? '').toLowerCase();

  // Longest keys first, so "united kingdom" is not matched as "uk" inside another word.
  const keys = Object.keys(LOCATION_COUNTRIES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)) {
      return LOCATION_COUNTRIES[key];
    }
  }

  // A German advert without a usable location is a German role often enough to be worth defaulting.
  // Accepts the code and the name in either language: "de", "deu", "German", "Deutsch".
  if (/^(de|deu|ger)/.test((spec.language ?? '').toLowerCase())) return 'de';
  return undefined;
}

/**
 * Makes a company or role title safe to sit in a filename.
 *
 * Advert titles routinely carry a slash ("Next.js / Node.js"), which is a path separator and would
 * silently create a subdirectory rather than fail. Colons are dropped for the same reason. The text
 * is otherwise left alone, so the filename still reads as the advert's own title.
 */
export function safeForFilename(text: string): string {
  return text
    .replace(/\s*[\/\\]\s*/g, ' - ')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** "01 02 26": the date form already used by the sent letters and the build script. */
export function formatFileDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())} ${pad(date.getMonth() + 1)} ${String(date.getFullYear()).slice(-2)}`;
}

/** Desktop/job applications/countries/<country>/<company-slug>. */
export function applicationDir(country: string, company: string, home: string = os.homedir()): string {
  return path.join(home, 'Desktop', 'job applications', 'countries', country, slugifyCompany(company));
}

export function jobSpecFilename(company: string, roleTitle: string, date: Date): string {
  return `${safeForFilename(company)} - ${safeForFilename(roleTitle)} Job Spec - ${formatFileDate(date)}.md`;
}

/**
 * The letter's basename, without extension, because build-letter.sh appends .docx and .pdf itself.
 */
export function coverLetterBasename(
  candidate: string,
  company: string,
  roleTitle: string,
  date: Date,
): string {
  return `${candidate} - ${safeForFilename(company)} - ${safeForFilename(roleTitle)} Cover Letter - ${formatFileDate(date)}`;
}
