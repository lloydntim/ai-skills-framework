import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-args';

describe('parseArgs', () => {
  it('parses multiple --key=value flags', () => {
    expect(parseArgs(['--source=de', '--target=en'])).toEqual({ source: 'de', target: 'en' });
  });

  it('returns an empty object for no arguments', () => {
    expect(parseArgs([])).toEqual({});
  });

  it('ignores a bare flag with no "="', () => {
    expect(parseArgs(['--verbose', '--source=de'])).toEqual({ source: 'de' });
  });

  it('ignores a positional argument with no leading "--"', () => {
    expect(parseArgs(['input.txt', '--source=de'])).toEqual({ source: 'de' });
  });

  it('captures everything after the first "=" when the value itself contains one', () => {
    expect(parseArgs(['--instructions=translate a=b literally'])).toEqual({
      instructions: 'translate a=b literally',
    });
  });

  it('accepts an empty value', () => {
    expect(parseArgs(['--out='])).toEqual({ out: '' });
  });

  it('preserves a multi-line value', () => {
    expect(parseArgs(['--instructions=line one\nline two'])).toEqual({
      instructions: 'line one\nline two',
    });
  });

  it('keeps the last value when the same flag is passed twice', () => {
    expect(parseArgs(['--model=a', '--model=b'])).toEqual({ model: 'b' });
  });
});
