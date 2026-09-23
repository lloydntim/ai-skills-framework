import { describe, expect, it } from 'vitest';
import {
  applicationDir,
  countryCodeFor,
  coverLetterBasename,
  formatFileDate,
  jobSpecFilename,
  safeForFilename,
  slugifyCompany,
} from './application-files';

const DATE = new Date(2026, 1, 1); // 1 February 2026

describe('slugifyCompany', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugifyCompany('Global Enterprise')).toBe('global-enterprise');
  });

  it('leaves a single word as one token', () => {
    expect(slugifyCompany('MediClean')).toBe('mediclean');
    expect(slugifyCompany('Atolls')).toBe('atolls');
  });

  it('drops dots rather than turning them into separators', () => {
    expect(slugifyCompany('Nord.Energie')).toBe('nordenergie');
  });

  it('spells out an ampersand instead of dropping the word boundary', () => {
    expect(slugifyCompany('Lumen & Vale')).toBe('lumen-and-vale');
  });

  it('strips accents and punctuation', () => {
    expect(slugifyCompany('Zürich Versicherung')).toBe('zurich-versicherung');
    expect(slugifyCompany("O'Reilly Media, Inc.")).toBe('oreilly-media-inc');
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugifyCompany('  -Acme-  ')).toBe('acme');
  });
});

describe('countryCodeFor', () => {
  it('reads the country out of the advert location', () => {
    expect(countryCodeFor({ location: 'Munich' })).toBe('de');
    expect(countryCodeFor({ location: 'London, UK' })).toBe('uk');
    expect(countryCodeFor({ location: 'Dublin' })).toBe('ie');
    expect(countryCodeFor({ location: 'Zürich' })).toBe('ch');
  });

  it('prefers the longer location name, so "united kingdom" is not read as something else', () => {
    expect(countryCodeFor({ location: 'United Kingdom' })).toBe('uk');
  });

  it('falls back to the language of the advert when there is no location', () => {
    expect(countryCodeFor({ language: 'de' })).toBe('de');
    expect(countryCodeFor({ language: 'German' })).toBe('de');
  });

  it('returns undefined rather than guessing when neither settles it', () => {
    expect(countryCodeFor({})).toBeUndefined();
    expect(countryCodeFor({ location: 'Remote', language: 'en' })).toBeUndefined();
  });
});

describe('formatFileDate', () => {
  it('is zero-padded DD MM YY', () => {
    expect(formatFileDate(DATE)).toBe('01 02 26');
    expect(formatFileDate(new Date(2026, 8, 12))).toBe('12 09 26');
  });
});

describe('applicationDir', () => {
  it('files under the country then the slugified company', () => {
    expect(applicationDir('de', 'MediClean', '/Users/test')).toBe(
      '/Users/test/Desktop/job applications/countries/de/mediclean',
    );
  });

  it('slugifies a multi-word company in the path', () => {
    expect(applicationDir('de', 'Global Enterprise', '/Users/test')).toBe(
      '/Users/test/Desktop/job applications/countries/de/global-enterprise',
    );
  });
});

describe('safeForFilename', () => {
  it('turns a slash into a separator rather than a subdirectory', () => {
    expect(safeForFilename('Senior Engineer (TypeScript, Next.js / Node.js)')).toBe(
      'Senior Engineer (TypeScript, Next.js - Node.js)',
    );
  });

  it('drops characters that break a filename', () => {
    expect(safeForFilename('Engineer: Frontend *urgent*?')).toBe('Engineer Frontend urgent');
  });
});

describe('the two filenames', () => {
  it('never lets a role title introduce a path separator', () => {
    const name = jobSpecFilename('Atolls', 'Senior Software Engineer (TypeScript, Next.js / Node.js)', DATE);
    expect(name).not.toContain('/');
    expect(name).toBe(
      'Atolls - Senior Software Engineer (TypeScript, Next.js - Node.js) Job Spec - 01 02 26.md',
    );
  });

  it('names the job spec after the company and role', () => {
    expect(jobSpecFilename('MediClean', 'Fullstack Developer', DATE)).toBe(
      'MediClean - Fullstack Developer Job Spec - 01 02 26.md',
    );
  });

  it('leads the cover letter with the candidate and carries no extension', () => {
    expect(coverLetterBasename('Jordan Sample', 'MediClean', 'Fullstack Developer', DATE)).toBe(
      'Jordan Sample - MediClean - Fullstack Developer Cover Letter - 01 02 26',
    );
  });

  it('keeps the company readable in the filename even though the folder is slugified', () => {
    expect(jobSpecFilename('Global Enterprise', 'Frontend Engineer', DATE)).toContain(
      'Global Enterprise - Frontend Engineer Job Spec',
    );
    expect(applicationDir('de', 'Global Enterprise', '/Users/test')).toContain('global-enterprise');
  });
});
