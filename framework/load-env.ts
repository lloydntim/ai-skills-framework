import path from 'node:path';
import dotenv from "dotenv";

/**
 * Reads `.env` files into process.env: first the one in the skill folder, then the one in the
 * repository root. A value that is already set is never replaced, so a variable set in the shell wins,
 * then the skill's `.env`, then the root's. Commands are run from the skill folder (pnpm does this).
 */
export function loadEnv(cwd: string = process.cwd()): void {
  for (const dir of [cwd, path.resolve(cwd, '..', '..')]) {
    dotenv.config({ path: path.join(dir, '.env'), quiet: true });
  }
}
