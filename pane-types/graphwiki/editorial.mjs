import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const rules = [
  [/^\s*(?:sources?|references?|citations?|bibliography|provenance|attribution|authors?|doi|url)::/i, 'provenance properties belong in the journal'],
  [/\[\[\d{4}-\d{2}-\d{2}(?:\]\]|[#|])|\]\([^)]*journals\//i, 'journal references belong outside articles'],
  [/https?:\/\/|\[\^[^\]]+\]/i, 'external references and footnotes belong in the journal'],
  [/^\s*#{1,6}\s+(?:sources?|references?|bibliography|provenance|attribution|research history|source comparisons?)\b/i, 'source sections belong in the journal'],
  [/\bthe author['’]s\b|\bdefined by the author\b|\b(?:from|quoted in) the (?:source|paper|report|cheatsheet|playbook|blog)\b/i, 'attribution belongs in the journal'],
];

function documents(directory) {
  if (!lstatSync(directory).isDirectory()) throw Error(`Expected a directory: ${directory}`);
  return new Map(readdirSync(directory).filter(name => name.endsWith('.md')).sort().map(name => {
    const file = join(directory, name);
    if (!lstatSync(file).isFile()) throw Error(`Expected a regular Markdown file: ${file}`);
    return [name, file];
  }));
}

function inspect(file) {
  const failures = [];
  let fence;
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const prose = line.replace(/(`+)[^`]*?\1/g, '');
    for (const [pattern, message] of rules) {
      if (pattern.test(prose)) failures.push(`${file}:${index + 1}: ${message}`);
    }
  }
  return failures;
}

function main() {
  if (!process.env.GRAPH_ROOT) throw Error('GRAPH_ROOT is required');
  const graph = realpathSync(process.env.GRAPH_ROOT);
  const pages = documents(join(graph, 'pages'));
  const change = process.env.CHANGE;
  if (change) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change)) throw Error('CHANGE must be a lowercase hyphenated identifier');
    const draft = join(graph, '.drafts', change);
    if (!lstatSync(draft).isDirectory()) throw Error(`Expected a draft directory: ${draft}`);
    const directory = join(draft, 'pages');
    if (existsSync(directory)) for (const [name, file] of documents(directory)) pages.set(name, file);
  }
  const articles = [...pages].filter(([name]) => !['index.md', 'log.md'].includes(name));
  const failures = articles.flatMap(([, file]) => inspect(file));
  if (failures.length) throw Error(`Editorial checks failed:\n${failures.join('\n')}`);
  console.log(`Editorial checks passed (${articles.length} articles). Manually review source narration and uncertainty before publishing.`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
