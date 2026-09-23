import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdoptionBand, CheckName } from './checks';

/**
 * The behavioral scenarios required for the skill-framework skill itself. Each case is a
 * request a user might make of the skill-framework skill, plus the deterministic checks its
 * response must satisfy (blueprint section 9: measure observable invariants for a workflow skill,
 * not prose quality).
 *
 * The eval makes one call with no tools, so a case that names a file also puts its contents in the
 * request; otherwise the model can only say it would read the file.
 *
 * Cases that hinge on "did it find the current instruction source" build an isolated fixture
 * directory under the OS temp dir (never inside this repository) so a run never touches, and is
 * never confused with, this project's own skill or eval files.
 */

export interface CaseCheck {
  name: CheckName;
  arg?: unknown;
}

export interface FrameworkCase {
  id: string;
  description: string;
  /** Builds an isolated fixture and returns the request text plus a cleanup function. */
  setup(): { requestText: string; fixtureDir: string; cleanup(): void };
  expectedChecks: CaseCheck[];
}

function tmpFixture(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skill-framework-eval-${prefix}-`));
}

function noFixtureNeeded(requestText: string): { requestText: string; fixtureDir: string; cleanup(): void } {
  const dir = tmpFixture('none');
  return { requestText, fixtureDir: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export const FRAMEWORK_CASES: FrameworkCase[] = [
  {
    id: 'new-low-risk-skill',
    description: 'A new, low-risk skill where steps 1-2 are sufficient.',
    setup: () =>
      noFixtureNeeded(
        'I want to write a small skill that reformats meeting notes into a bullet list. ' +
          'It has never existed before and a wrong bullet costs nothing. Help me set it up with this framework.'
      ),
    expectedChecks: [
      { name: 'recommendsAppropriateBand', arg: 'steps-1-2' satisfies AdoptionBand },
      { name: 'explainsCostBeforeScaffolding' },
    ],
  },

  {
    id: 'mature-high-risk-text-skill',
    description: 'A mature, high-risk text skill that justifies the full evaluation framework.',
    setup: () => {
      const dir = tmpFixture('mature-skill');
      const skillPath = path.join(dir, 'legal-summary-skill.md');
      const skillText = [
        '# Legal Summary Skill',
        '',
        'Summarises signed contracts for a non-lawyer audience. In production for 8 months, edited weekly.',
        'A wrong summary has shipped a false obligation to a client before.',
      ].join('\n');
      fs.writeFileSync(skillPath, skillText);
      return {
        requestText:
          `The instructions live at ${skillPath}. Its full contents:\n\n${skillText}\n\n` +
          'This skill summarises signed legal contracts, has been ' +
          'in production for 8 months, gets edited weekly, and a wrong summary already caused a real ' +
          'incident where a client was told they owed something they did not. Should we add evaluation to it?',
        fixtureDir: dir,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
      };
    },
    expectedChecks: [
      { name: 'findsInstructionSource', arg: ['legal-summary-skill.md'] },
      { name: 'recommendsAppropriateBand', arg: 'steps-5-8' satisfies AdoptionBand },
      { name: 'explainsCostBeforeScaffolding' },
    ],
  },

  {
    id: 'duplicated-instructions',
    description: 'An existing skill whose instructions are duplicated across files.',
    setup: () => {
      const dir = tmpFixture('duplicated-skill');
      const rule =
        'Never invent a metric that is not present in the original source text, under any circumstance.';
      const skillText = `# Rewrite Skill\n\n${rule}\n`;
      const wrapperText = `# Chat Wrapper\n\n${rule}\n\nRespond in chat.`;
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText);
      fs.writeFileSync(path.join(dir, 'chat-wrapper.md'), wrapperText);
      return {
        requestText:
          `This skill's instructions are pasted into both ${path.join(dir, 'SKILL.md')} and ` +
          `${path.join(dir, 'chat-wrapper.md')}, word for word. Consolidate it into one source file ` +
          'the framework can load, without changing the wording of the existing rule. Show the ' +
          `resulting file.\n\nSKILL.md:\n\n${skillText}\nchat-wrapper.md:\n\n${wrapperText}\n`,
        fixtureDir: dir,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
      };
    },
    expectedChecks: [
      { name: 'findsInstructionSource', arg: ['SKILL.md', 'chat-wrapper.md'] },
      {
        name: 'preservesWordingDuringRestructuring',
        arg: ['Never invent a metric that is not present in the original source text, under any circumstance.'],
      },
    ],
  },

  {
    id: 'portable-with-claude-code-adapter',
    description: 'A request for a portable skill with a Claude Code adapter.',
    setup: () =>
      noFixtureNeeded(
        'I want this skill to work as a portable Agent Skill in any host, but also install cleanly ' +
          'into Claude Code with manual invocation. How should the files be organised?'
      ),
    expectedChecks: [{ name: 'separatesPortableFromAdapter' }],
  },

  {
    id: 'compare-with-and-without-skill',
    description: 'A request to compare the same model with and without a skill.',
    setup: () =>
      noFixtureNeeded(
        'I want to know whether giving the model this skill actually helps, compared to just asking ' +
          'the plain model the same question with no skill at all. Set up that comparison.'
      ),
    expectedChecks: [{ name: 'definesValidSameModelBaseline' }],
  },

  {
    id: 'mechanically-testable-output',
    description: 'A skill with only mechanically testable output.',
    setup: () =>
      noFixtureNeeded(
        'This skill only ever extracts a fixed JSON schema (three required fields, nothing else) from ' +
          'plain text. Correctness is either right or wrong; there is no prose quality question at all. ' +
          'What evaluation does this actually need?'
      ),
    expectedChecks: [{ name: 'recommendsAppropriateBand', arg: 'steps-3-4' satisfies AdoptionBand }],
  },

  {
    id: 'paid-evaluation-not-worth-it',
    description: 'A request where a paid evaluation framework would cost more than it is worth.',
    setup: () =>
      noFixtureNeeded(
        'This skill runs twice a year for an internal one-off report and I will probably never touch ' +
          'the instructions again. Should I build the full judge-and-runner evaluation framework for it?'
      ),
    expectedChecks: [
      { name: 'explainsCostBeforeScaffolding' },
      { name: 'recommendsAppropriateBand', arg: 'steps-1-2' satisfies AdoptionBand },
      { name: 'noUnmeasuredImprovementClaim' },
    ],
  },

  {
    id: 'context-for-new-skill',
    description: 'A new skill with large optional material, personal details and a checker: context is decided unprompted.',
    setup: () =>
      noFixtureNeeded(
        'I want a skill that drafts replies to customer support tickets. It has our 60-page product ' +
          'manual to go on, though most tickets touch one product area. Each reply ends with the support ' +
          "agent's own name and direct phone number. Later I also want a model to review each reply for " +
          'promises we cannot keep. Help me set this skill up.'
      ),
    expectedChecks: [{ name: 'decidesWhatTheSkillLoads' }],
  },
];
