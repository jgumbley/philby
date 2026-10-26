import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { models } from '../dist/src/models.js';
import { configRoot, consultationDefaults } from '../dist/src/providers.js';

export function readPrompt(env = process.env, input = process.stdin) {
  let prompt;
  if (env.PROMPT_FILE) prompt = readFileSync(env.PROMPT_FILE, 'utf8');
  else if (env.PROMPT) prompt = env.PROMPT;
  else {
    if (input.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
    prompt = readFileSync(input.fd, 'utf8');
  }
  if (!prompt.trim()) throw Error('A nonempty research prompt is required');
  return prompt;
}

export async function research(prompt, { env = process.env, fetch = globalThis.fetch, signal = AbortSignal.timeout(120_000) } = {}) {
  if (!prompt.trim()) throw Error('A nonempty research prompt is required');
  const reference = env.RESEARCH_MODEL || consultationDefaults.research;
  if (reference.endsWith(':online')) throw Error('RESEARCH_MODEL must omit :online; research already enables web search and fetch');
  const config = await models(reference, { directory: env.PHILBY_ROOT || configRoot(), env: { ...env, PHILBY_TEST_PROVIDER: undefined } });
  if (config.providerType !== 'openrouter') throw Error('Research requires OpenRouter web tools; select an OpenRouter model with RESEARCH_MODEL');
  const model = config.model.modelId;
  const provider = config.models.getProvider(config.model.provider);
  const key = (await config.models.getAuth(config.model.provider)).auth.apiKey;
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'Use web search and fetch to answer the practical question. Prefer official project documentation. Give a concise answer with the useful next step and a project or documentation link when helpful. Be explicit when the available information is insufficient.' },
          { role: 'user', content: prompt },
        ],
        tools: [{ type: 'openrouter:web_search' }, { type: 'openrouter:web_fetch' }],
        max_tool_calls: 6,
      }),
    });
    let result;
    try { result = await response.json(); }
    catch (error) {
      if (signal.aborted) throw error;
      throw Error(`OpenRouter returned invalid JSON (HTTP ${response.status})`);
    }
    const problem = result?.error || result?.choices?.[0]?.error;
    if (!response.ok || problem) {
      const detail = typeof problem?.message === 'string' ? `: ${problem.message}` : '';
      throw Error(`OpenRouter request failed (HTTP ${response.status})${detail}`);
    }
    const choice = result?.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string') throw Error('OpenRouter returned an invalid answer');
    if (choice.finish_reason !== 'stop') throw Error(`OpenRouter research did not complete: ${choice.finish_reason || 'missing finish reason'}`);
    const answer = choice.message.content.trim();
    if (!answer) throw Error('OpenRouter returned an empty answer');
    return answer;
  } catch (error) {
    if (signal.aborted) throw Error('Research timed out after two minutes');
    throw Error((error instanceof Error ? error.message : String(error)).replaceAll(key, '[redacted]'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const envFile = resolve(configRoot(), '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    console.log(await research(readPrompt()));
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
