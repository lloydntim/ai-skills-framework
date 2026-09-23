import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The tests run against the fictional candidate in candidate-profile.example.md, so they behave
// the same here and in an exported copy, and never depend on the real candidate's details. Tests
// that check the real profile against the real CV load reference/ explicitly and are skipped
// where it is absent (see src/reference-cv.ts).
export default defineConfig({
  test: {
    env: { COVER_LETTER_PROFILE: path.join(__dirname, 'candidate-profile.example.md') },
  },
});
