import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(process.env.PHILBY_ROOT || fileURLToPath(new URL('../../', import.meta.url)));
if(existsSync(join(root,'.env'))) process.loadEnvFile(join(root,'.env'));
export const piAgentDir = join(root,'.pi','agent');
process.env.PI_CODING_AGENT_DIR = piAgentDir;
