import path from 'node:path';
import { AnthropicProvider } from '@skills/framework/provider/anthropic-provider';
import { loadModelRoles as load, loadRawModelRolesConfig as loadRaw } from '@skills/framework/provider/load-model-roles';
import type { ProviderFactory } from '@skills/framework/provider/registry';
import { LedgerProvider } from './usage/ledger-provider';

/** Where this skill keeps its model-role configuration. `--models-config=<path>` overrides it. */
export const MODELS_CONFIG_PATH = path.join(__dirname, '..', 'config', 'models.json');

/** The real providers, each wrapped so every call also lands in this skill's usage ledger. */
const FACTORIES: Record<string, ProviderFactory> = {
  anthropic: () => new LedgerProvider(new AnthropicProvider(), 'anthropic'),
};

export const loadRawModelRolesConfig = (configPath: string = MODELS_CONFIG_PATH) => loadRaw(configPath);
export const loadModelRoles = (configPath: string = MODELS_CONFIG_PATH) => load(configPath, FACTORIES);
