import { loadCases as loadCasesFrom } from '@skills/framework/evals/cases-loader';
import type { EvalCase } from './types';

export const loadCases = (dir: string): EvalCase[] => loadCasesFrom<EvalCase>(dir);
