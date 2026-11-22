import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { recordSearch } from '../src/search-record.js';

test('a frame retains ranked evidence in dated sections for each query', t => {
  const frame = mkdtempSync(join(tmpdir(), 'philby-search-'));
  t.after(() => rmSync(frame, { recursive: true, force: true }));
  const query = 'Pi Durable tool replay';
  const results = [
    { title: 'Tool execution', url: 'https://example.org/tools', excerpt: 'replay: "safe"' },
    { title: 'Recovery', url: 'https://example.org/recovery', excerpt: 'Interrupted work' }
  ];
  const path = recordSearch(frame, query, results);
  assert.match(path, /^\.searches\/pi-durable-tool-replay-[a-f0-9]+\.md$/);
  const original = readFileSync(join(frame, path), 'utf8');
  assert.match(original, /^## \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\n/);
  assert.ok(original.includes(query));
  for (const [index, result] of results.entries()) {
    assert.ok(original.includes(`### ${index + 1}. ${result.title}\n\n<${result.url}>\n\n${result.excerpt}`));
  }
  assert.equal(recordSearch(frame, query, [results[1]]), path);
  const updated = readFileSync(join(frame, path), 'utf8');
  assert.ok(updated.startsWith(original));
  assert.match(updated.slice(original.length), /^## .*Z[\s\S]*### 1\. Recovery/);
  const other = recordSearch(frame, '../Pi\nDurable tool replay?', []);
  assert.equal(dirname(other), '.searches');
  assert.notEqual(other, path);
  assert.ok(readFileSync(join(frame, other), 'utf8').includes('../Pi\nDurable tool replay?'));
});
