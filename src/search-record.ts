import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

export type SearchResult = { title: string; url: string; excerpt: string };

export function recordSearch(frameDirectory: string, query: string, results: SearchResult[]): string {
  if (!query.trim()) throw Error('A search query is required');
  const words = query.normalize('NFKC').toLowerCase().match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  const slug = Array.from(words.join('-')).slice(0, 48).join('').replace(/-$/, '') || 'search';
  const digest = createHash('sha256').update(query.trim()).digest('hex').slice(0, 16);
  const relative = join('.searches', `${slug}-${digest}.md`);
  const entries = results.map(({ title, url, excerpt }, index) =>
    `### ${index + 1}. ${title.replace(/\s+/g, ' ')}\n\n<${url}>\n\n${excerpt}`
  );
  const section = [`## ${new Date().toISOString()}`, `Query:\n\n${query}`, ...(entries.length ? entries : ['No results.'])].join('\n\n') + '\n\n';
  const directory = join(frameDirectory, '.searches');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) throw Error('.searches must be a directory in the calling frame');
  const file = openSync(join(frameDirectory, relative), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    appendFileSync(file, section);
  } finally {
    closeSync(file);
  }
  return relative;
}
