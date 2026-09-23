/**
 * Parses `--flag=value` arguments from argv. Shared by every CLI entry point in this repo (was
 * previously copy-pasted six times) so a value containing "=" or a newline (e.g. a multi-line
 * --instructions="...") is parsed identically everywhere.
 */
export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=([\s\S]*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}
