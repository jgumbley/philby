import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync, chmodSync, writeFileSync, lstatSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profiles = readdirSync(root).filter(file => file.endsWith('.provider'));
const mode = process.argv[2];
if (mode === 'state-list') {
  for (const name of readdirSync(join(root, '.state'))) {
    const info = lstatSync(join(root, '.state', name));
    console.log(JSON.stringify({ name, type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', bytes: info.size }));
  }
  process.exit(0);
}
if (mode === 'backup-remove') {
  const name = process.env.BACKUP;
  if (!name || !/^provider-upgrade-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/.test(name)) throw Error('BACKUP must name one provider-upgrade timestamp directory');
  const path = join(root, '.state', name);
  if (!lstatSync(path).isDirectory()) throw Error('Backup must be a directory');
  if (!/^[a-f0-9]{40}\s*$/.test(readFileSync(join(path, 'revision'), 'utf8'))) throw Error('Missing backup revision marker');
  rmSync(path, { recursive: true });
  if (existsSync(path)) throw Error('Backup removal failed');
  console.log('Removed migration backup: ' + name);
  process.exit(0);
}
if (mode === 'verify') {
  const { piAgentDir } = await import('../../dist/src/config.js');
  const { configuredModels, modelScope } = await import('../../dist/src/models.js');
  const legacy = parseEnv(readFileSync(join(root, 'openrouter.provider'), 'utf8'));
  const authPath = join(piAgentDir, 'auth.json');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  if (auth.openrouter?.key !== legacy.API_KEY) throw Error('Credential mismatch');
  const runtime = await configuredModels();
  if (runtime.getError()) throw Error(runtime.getError());
  const scope = await modelScope(runtime);
  if (scope.errors.length) throw Error(scope.errors.join('\n'));
  for (const { model } of scope.scopedModels) {
    if (model.maxTokens > 8192) throw Error('Output limit not applied');
  }
  execFileSync('git', ['check-ignore', authPath, join(piAgentDir, 'settings.json'), join(piAgentDir, 'models.json')], { cwd: root });
  console.log(JSON.stringify({ credentialMatches: true, nativeShortlist: scope.scopedModels.map(({ model }) => model.provider + '/' + model.id), outputLimitsVerified: true, privateConfigIgnoredByGit: true }));
  process.exit(0);
}
if (mode === 'limit-output') {
  const { piAgentDir } = await import('../../dist/src/config.js');
  const legacy = parseEnv(readFileSync(join(root, 'openrouter.provider'), 'utf8'));
  const path = join(piAgentDir, 'models.json');
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const providers = config.providers ??= {};
  const overrides = (providers.openrouter ??= {}).modelOverrides ??= {};
  const ids = [...new Set([...legacy.MODELS.split(',').map(id => id.trim()), 'openai/gpt-5.5', 'x-ai/grok-4.3'])];
  for (const id of ids) {
    const current = overrides[id] ??= {};
    current.maxTokens = Math.min(current.maxTokens ?? 8192, 8192);
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ outputLimit: 8192, models: ids.length }));
  process.exit(0);
}
if (mode === 'migrate') {
  if (profiles.length !== 1 || profiles[0] !== 'openrouter.provider') throw Error('Migration expects the diagnosed OpenRouter-only configuration');
  const legacy = parseEnv(readFileSync(join(root, profiles[0]), 'utf8'));
  if (legacy.TYPE !== 'openrouter' || !legacy.API_KEY?.trim()) throw Error('Missing legacy OpenRouter API key');
  const { piAgentDir } = await import('../../dist/src/config.js');
  const { ModelRuntime, SettingsManager } = await import('@earendil-works/pi-coding-agent');
  const authPath = join(piAgentDir, 'auth.json');
  const stored = existsSync(authPath) ? JSON.parse(readFileSync(authPath, 'utf8')) : {};
  if (stored.openrouter && (stored.openrouter.type !== 'api_key' || stored.openrouter.key !== legacy.API_KEY)) throw Error('Existing Pi OpenRouter credential differs; refusing replacement');
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  if (!stored.openrouter) {
    try {
      await runtime.login('openrouter', 'api_key', {
        prompt: async prompt => {
          if (prompt.type !== 'secret') throw Error('Unexpected authentication prompt');
          return legacy.API_KEY;
        },
        notify: () => {},
      });
    } catch { throw Error('Pi credential migration failed; inspect provider status without printing credentials'); }
  }
  const saved = JSON.parse(readFileSync(authPath, 'utf8'));
  if (saved.openrouter?.type !== 'api_key' || saved.openrouter.key !== legacy.API_KEY) throw Error('Pi credential verification failed');
  const settings = SettingsManager.create(root, piAgentDir);
  if (settings.drainErrors().length) throw Error('Existing Pi settings are invalid');
  const shortlist = legacy.MODELS.split(',').map(id => 'openrouter/' + id.trim());
  settings.setEnabledModels([...new Set([...(settings.getEnabledModels() || []), ...shortlist])]);
  await settings.flush();
  if (settings.drainErrors().length) throw Error('Pi settings could not be saved');
  chmodSync(piAgentDir, 0o700);
  chmodSync(authPath, 0o600);
  chmodSync(join(piAgentDir, 'settings.json'), 0o600);
  console.log(JSON.stringify({ migrated: 'openrouter', keyMatchesLegacy: true, shortlistedModels: shortlist.length, defaultUnchanged: true }));
  process.exit(0);
}
if (mode === 'backup') {
  const state = execFileSync('make', ['-s', 'frame-list'], { cwd: root, encoding: 'utf8' });
  if (/\trunning\b/.test(state)) throw Error('Close running frames before backup');
  const destination = join(root, '.state', 'provider-upgrade-' + new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(destination, { mode: 0o700 });
  for (const file of ['.env', ...profiles, '.pi', '.state/providers.sqlite', '.state/providers.sqlite-wal', '.state/providers.sqlite-shm']) {
    if (!existsSync(join(root, file))) continue;
    const target = join(destination, file);
    mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
    cpSync(join(root, file), target, { recursive: true, errorOnExist: true, force: false });
    chmodSync(target, file === '.pi' ? 0o700 : 0o600);
  }
  let frames = 0;
  for (const slug of readdirSync(join(root, 'frames'))) {
    const source = join(root, 'frames', slug, '.state');
    if (!existsSync(source)) continue;
    const target = join(destination, 'frames', slug, '.state');
    mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
    cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    frames++;
  }
  writeFileSync(join(destination, 'revision'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ backup: destination, frames }));
  process.exit(0);
}
if (mode !== 'diagnose') throw Error('Expected diagnose, backup, migrate or limit-output');
for (const file of profiles) {
  const values = parseEnv(readFileSync(join(root, file), 'utf8'));
  console.log(JSON.stringify({ file, type: values.TYPE, models: values.MODELS, auth: values.AUTH, hasApiKey: !!values.API_KEY?.trim(), keys: Object.keys(values) }));
}
const env = parseEnv(readFileSync(join(root, '.env'), 'utf8'));
console.log(JSON.stringify({ envKeys: Object.keys(env), selections: Object.fromEntries(['DEFAULT_MODEL', 'ASK_MODEL', 'REASON_MODEL', 'TWITTER_MODEL'].filter(key => env[key]).map(key => [key, env[key]])) }));
for (const file of ['auth.json', 'settings.json', 'models.json']) {
  const path = join(root, '.pi/agent', file);
  console.log(JSON.stringify({ file: '.pi/agent/' + file, exists: existsSync(path), keys: existsSync(path) ? Object.keys(JSON.parse(readFileSync(path, 'utf8'))) : [] }));
}
console.log(JSON.stringify({ legacyOAuthStoreExists: existsSync(join(root, '.state/providers.sqlite')) }));
if (existsSync(join(root, '.state/providers.sqlite'))) {
  const db = new DatabaseSync(join(root, '.state/providers.sqlite'), { readOnly: true });
  try {
    console.log(JSON.stringify({ legacyCredentials: db.prepare("SELECT provider, json_extract(value, '$.type') AS type FROM credentials").all() }));
  } finally { db.close(); }
}
