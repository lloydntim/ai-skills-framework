import path from 'node:path';
import { loadModelRoles as load, loadRawModelRolesConfig as loadRaw } from '@skills/framework/provider/load-model-roles';

/** Where this skill keeps its model-role configuration. `--models-config=<path>` overrides it. */
export const MODELS_CONFIG_PATH = path.join(__dirname, '..', 'config', 'models.json');

export const loadRawModelRolesConfig = (configPath: string = MODELS_CONFIG_PATH) => loadRaw(configPath);
export const loadModelRoles = (configPath: string = MODELS_CONFIG_PATH) => load(configPath);
