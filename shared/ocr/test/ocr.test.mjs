import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createCanvas, GlobalFonts} from '@scribe.js/canvas';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const makefile = join(root, 'shared', 'Makefile');
let directory;
let native;
let image;
let jpeg;
let scanned;
let mixed;
let offline;

function pdf(pages) {
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), null, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')];
  const pageIds = [];
  const add = value => objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  const stream = (dictionary, data) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
  for (const page of pages) {
    const pageId = add('');
    pageIds.push(pageId);
    let content;
    let resources = '/Font << /F1 3 0 R >>';
    if (page.image) {
      const imageId = add(stream('/Type /XObject /Subtype /Image /Width 1400 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', page.image));
      resources += ` /XObject << /Im0 ${imageId} 0 R >>`;
      content = Buffer.from('q 700 0 0 250 0 0 cm /Im0 Do Q');
    } else {
      const lines = page.lines.map(line => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n');
      content = Buffer.from(`BT /F1 16 Tf 60 720 Td 28 TL\n${lines}\nET`);
    }
    const contentId = add(stream('', content));
    objects[pageId - 1] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.image ? '700 250' : '612 792'}] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

function invoke(input, output, cwd = directory) {
  const env = {...process.env};
  delete env.INPUT;
  delete env.OUTPUT;
  env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --import=${pathToFileURL(offline).href}`;
  const args = ['--no-print-directory', '-s', '-f', makefile, 'ocr'];
  if (input !== undefined) args.push(`INPUT=${input}`);
  if (output !== undefined) args.push(`OUTPUT=${output}`);
  const command = spawn('make', args, {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  command.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  command.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-command.pid, 'SIGKILL'); } catch {}
      reject(Error(`OCR command did not exit within 60 seconds\n${stderr}`));
    }, 60000);
    command.once('error', error => { clearTimeout(timer); reject(error); });
    command.once('close', (code, signal) => { clearTimeout(timer); resolve({code, signal, stdout, stderr}); });
  });
}

function success(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

function failure(result) {
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'philby-ocr-'));
  offline = join(directory, 'offline.mjs');
  await writeFile(offline, `import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const denied = () => { throw Error('Network access is disabled in OCR tests'); };
http.get = http.request = https.get = https.request = globalThis.fetch = denied;
syncBuiltinESMExports();
`);
  assert.ok(GlobalFonts.registerFromPath(join(root, 'node_modules/scribe.js-ocr/fonts/NotoSansSC-Regular.ttf'), 'OCR Fixture'));
  const canvas = createCanvas(1400, 500);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '52px "OCR Fixture"';
  context.fillText('Portable document sample', 70, 120);
  context.fillText('Repeated statement remains', 70, 220);
  context.fillText('Repeated statement remains', 70, 320);
  image = join(directory, 'image.png');
  jpeg = join(directory, 'image.jpeg');
  const jpegData = await canvas.encode('jpeg', 95);
  await writeFile(image, await canvas.encode('png'));
  await writeFile(jpeg, jpegData);
  const lines = ['Native page one', 'A repeated line remains here.', 'A repeated line remains here.', 'The final sentence stays visible.'];
  native = join(directory, 'native.pdf');
  scanned = join(directory, 'scanned.pdf');
  mixed = join(directory, 'mixed.pdf');
  await writeFile(native, pdf([{lines}, {lines: []}, {lines: ['Native page two', ...lines.slice(1)]}]));
  await writeFile(scanned, pdf([{image: jpegData}]));
  await writeFile(mixed, pdf([{lines}, {image: jpegData}]));
});

after(async () => {
  if (directory) await rm(directory, {recursive: true, force: true});
});

test('native PDF preserves repeated text and page boundaries', async () => {
  const text = success(await invoke(native));
  assert.ok(text.endsWith('\n'));
  const pages = text.trimEnd().split('\n\f\n');
  assert.equal(pages.length, 3);
  assert.match(pages[0], /Native page one/);
  assert.equal(pages[1], '');
  assert.match(pages[2], /Native page two/);
  for (const page of [pages[0], pages[2]]) assert.equal(page.split('A repeated line remains here.').length - 1, 2);
});

test('PNG and JPEG recognition preserves repeated lines', async () => {
  for (const input of [image, jpeg]) {
    const text = success(await invoke(input));
    assert.match(text, /Portable document sample/);
    assert.equal(text.split('Repeated statement remains').length - 1, 2);
    assert.ok(text.endsWith('\n'));
  }
});

test('scanned and mixed PDFs retain recognized and native pages', async () => {
  assert.match(success(await invoke(scanned)), /Portable document sample/);
  const pages = success(await invoke(mixed)).trimEnd().split('\n\f\n');
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Native page one/);
  assert.equal(pages[0].split('A repeated line remains here.').length - 1, 2);
  assert.match(pages[1], /Portable document sample/);
});

test('missing, unsupported and corrupt inputs fail visibly', async () => {
  const invalid = join(directory, 'invalid.pdf');
  const unsupported = join(directory, 'unsupported.txt');
  const blank = join(directory, 'blank.pdf');
  await writeFile(invalid, 'This is not a PDF.');
  await writeFile(unsupported, 'Plain text is not an OCR input.');
  await writeFile(blank, pdf([{lines: []}]));
  for (const input of [undefined, join(directory, 'missing.pdf'), unsupported, invalid, blank, directory]) failure(await invoke(input));
});

test('OUTPUT writes exclusively and cannot overwrite input or existing files', async () => {
  const expected = success(await invoke(native));
  const output = join(directory, 'recognized.txt');
  assert.equal(success(await invoke(native, output)), '');
  assert.equal(await readFile(output, 'utf8'), expected);
  failure(await invoke(native, output));
  assert.equal(await readFile(output, 'utf8'), expected);
  const original = await readFile(native);
  failure(await invoke(native, native));
  assert.deepEqual(await readFile(native), original);
  const alias = join(directory, 'source-alias.txt');
  await symlink(native, alias);
  failure(await invoke(native, alias));
  assert.deepEqual(await readFile(native), original);
});

test('literal paths and caller working directory survive Make delegation', async () => {
  const cwd = join(directory, 'caller working directory');
  await mkdir(cwd);
  const input = 'literal $HOME $(shell touch injected) `touch injected` " quote.pdf';
  const output = 'literal $HOME $(shell touch injected) `touch injected` " output.txt';
  await writeFile(join(cwd, input), await readFile(native));
  const result = await invoke(input, output, cwd);
  assert.equal(existsSync(join(cwd, 'injected')), false, 'Make executed part of a literal filename');
  assert.equal(success(result), '');
  assert.match(await readFile(join(cwd, output), 'utf8'), /Native page one/);
});

test('concurrent invocations own their work and exit after releasing workers', async () => {
  const outputs = [join(directory, 'concurrent-one.txt'), join(directory, 'concurrent-two.txt')];
  const results = await Promise.all(outputs.map(output => invoke(image, output)));
  for (const result of results) assert.equal(success(result), '');
  const texts = await Promise.all(outputs.map(output => readFile(output, 'utf8')));
  assert.equal(texts[0], texts[1]);
  assert.match(texts[0], /Portable document sample/);
});
