import { readFileSync } from 'node:fs';
import { piAgentDir, root } from '../../dist/src/config.js';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { request } from '../../dist/src/ipc.js';
import { slug } from '../../dist/src/store.js';
import { modelReference } from '../../dist/src/providers.js';

const mode = process.argv[2];
if (mode === 'shortlist') {
  const settings = SettingsManager.create(root, piAgentDir);
  const check = () => {
    const errors = settings.drainErrors();
    if (errors.length) throw Error(errors.map(({ error }) => error.message).join('\n'));
  };
  check();
  settings.setEnabledModels([...new Set([...(settings.getEnabledModels() ?? []), 'openai/*astra*', 'openai/gpt-6.1-sol'])]);
  await settings.flush();
  check();
  console.log('Added Holly’s OpenAI choices to the existing shortlist.');
  process.exit(0);
}
if (mode === 'select') {
  const frame = slug(process.env.slug);
  const model = modelReference(process.env.MODEL);
  const result = await request(frame, { op: 'model', ...model });
  if (result.errors.length) throw Error(result.errors.join('\n'));
  if (result.current.provider !== model.provider || result.current.modelId !== model.modelId) throw Error('Model selection did not persist');
  console.log(JSON.stringify({ frame, ...result.current }));
  process.exit(0);
}
if (mode !== 'diagnose') throw Error('Expected diagnose');
const auth = JSON.parse(readFileSync(join(piAgentDir, 'auth.json'), 'utf8'));
const settings = JSON.parse(readFileSync(join(piAgentDir, 'settings.json'), 'utf8'));
const credential = auth.openai;
console.log(JSON.stringify({ root, provider: 'openai', type: credential?.type, fields: Object.keys(credential ?? {}), expires: credential?.expires, enabledModels: settings.enabledModels }, null, 2));
