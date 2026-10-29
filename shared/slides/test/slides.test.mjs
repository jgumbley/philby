import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const makefile = join(root, 'shared', 'Makefile');
const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve('pptxgenjs'))('jszip');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
let directory;

function invoke({target = 'slides-generate', makefile: selectedMakefile = makefile, cwd = directory, output, promptFile, prompt, source, stdin = ''} = {}) {
  const env = {...process.env};
  for (const name of ['MAKEFLAGS', 'MFLAGS', 'MAKEOVERRIDES', 'PROMPT_FILE', 'PROMPT', 'prompt', 'OUTPUT']) delete env[name];
  if (source !== undefined) env.PROMPT = source;
  const args = ['--no-print-directory', '-s', '-f', selectedMakefile, target];
  if (output !== undefined) args.push(`OUTPUT=${output}`);
  if (promptFile !== undefined) args.push(`PROMPT_FILE=${promptFile}`);
  if (prompt !== undefined) args.push(`prompt=${prompt}`);
  const child = spawn('make', args, {cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') child.emit('error', error);
  });
  child.stdin.end(stdin);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      reject(Error(`Slides command did not exit within 30 seconds\n${stderr}`));
    }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({code, signal, stdout, stderr}); });
  });
}

function success(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function failure(result) {
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
}

async function archive(path) {
  const zip = await JSZip.loadAsync(await readFile(path), {checkCRC32: true});
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml']) assert.ok(zip.file(name), name);
  assert.match(await zip.file('[Content_Types].xml').async('string'), /presentationml\.presentation\.main\+xml/);
  return zip;
}

before(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'philby-slides-')));
});

after(async () => {
  if (directory) await rm(directory, {recursive: true, force: true});
});

test('diagnostics verify the installed generator can serialize without producing a deck', async () => {
  const before = await readdir(directory);
  const result = success(await invoke({target: 'slides-diagnose'}));
  assert.ok(result.node);
  assert.ok(result.pptxgenjs);
  assert.equal(result.serialization, 'ok');
  assert.deepEqual(await readdir(directory), before);
});

test('source precedence and caller-relative assets produce valid presentations', async () => {
  const cwd = join(directory, 'working directory');
  await mkdir(cwd);
  await writeFile(join(cwd, 'image.png'), png);
  await writeFile(join(cwd, 'generate.mjs'), `await Promise.resolve();
const slide = pptx.addSlide();
slide.addText('From file', {x: 1, y: 1, w: 4, h: 1});
slide.addImage({path: 'image.png', x: 1, y: 2, w: 1, h: 1});
console.log('Script diagnostic');
`);
  const fileResult = await invoke({cwd, output: 'file.pptx', promptFile: 'generate.mjs', prompt: "throw Error('Wrong source: prompt')", stdin: "throw Error('Wrong source: stdin')"});
  assert.deepEqual(success(fileResult), {output: join(cwd, 'file.pptx')});
  assert.match(fileResult.stderr, /Script diagnostic/);
  const zip = await archive(join(cwd, 'file.pptx'));
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /From file/);
  const images = zip.file(/^ppt\/media\/.*\.png$/);
  assert.equal(images.length, 1);
  assert.deepEqual(await images[0].async('nodebuffer'), png);
  for (const [name, inputs] of [
    ['prompt', {prompt: "pptx.addSlide().addText('From prompt', {x: 1, y: 1, w: 4, h: 1});", source: "throw Error('Wrong source: environment')", stdin: "throw Error('Wrong source: stdin')"}],
    ['environment', {source: "pptx.addSlide().addText('From environment', {x: 1, y: 1, w: 4, h: 1});", stdin: "throw Error('Wrong source: stdin')"}],
    ['stdin', {stdin: "pptx.addSlide().addText('From stdin', {x: 1, y: 1, w: 4, h: 1});"}],
  ]) {
    const output = join(cwd, `${name}.pptx`);
    assert.deepEqual(success(await invoke({cwd, output, ...inputs})), {output});
    const generated = await archive(output);
    assert.match(await generated.file('ppt/slides/slide1.xml').async('string'), new RegExp(`From ${name}`));
  }
});

test('Make preserves literal script text, prompt filenames and output paths', async () => {
  const cwd = join(directory, 'literal arguments');
  await mkdir(cwd);
  const literal = '$HOME $(shell touch injected) `touch injected` " quote';
  const script = `pptx.addSlide().addText(${JSON.stringify(literal)}, {x: 1, y: 1, w: 7, h: 1});`;
  const output = `deck ${literal}.pptx`;
  const promptFile = `source ${literal}.mjs`;
  await writeFile(join(cwd, promptFile), script);
  assert.deepEqual(success(await invoke({cwd, output, prompt: script})), {output: join(cwd, output)});
  const xml = await (await archive(join(cwd, output))).file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /\$HOME \$\(shell touch injected\) `touch injected`/);
  const fromFile = `file ${literal}.pptx`;
  assert.deepEqual(success(await invoke({cwd, output: fromFile, promptFile})), {output: join(cwd, fromFile)});
  await archive(join(cwd, fromFile));
  for (const [name, inputs] of [
    ['environment', {source: script}],
    ['direct', {makefile: join(root, 'shared/slides/Makefile'), target: 'generate', prompt: script}],
  ]) {
    const output = `${name} ${literal}.pptx`;
    assert.deepEqual(success(await invoke({cwd, output, ...inputs})), {output: join(cwd, output)});
    const xml = await (await archive(join(cwd, output))).file('ppt/slides/slide1.xml').async('string');
    assert.match(xml, /\$HOME \$\(shell touch injected\) `touch injected`/);
  }
  assert.equal(existsSync(join(cwd, 'injected')), false);
});

test('failures leave no output and existing files and symlinks remain untouched', async () => {
  const cwd = join(directory, 'failures');
  await mkdir(cwd);
  const source = 'pptx.addSlide();';
  failure(await invoke({cwd, prompt: source}));
  for (const [name, inputs] of [
    ['empty', {}],
    ['missing-file', {promptFile: 'missing.mjs', prompt: source}],
    ['syntax', {prompt: 'const = ;'}],
    ['runtime', {prompt: "pptx.addSlide(); throw Error('Script failed');"}],
    ['missing-image', {prompt: "pptx.addSlide().addImage({path: 'missing.png', x: 1, y: 1, w: 1, h: 1});"}],
    ['serialization', {prompt: "pptx.addSlide(); pptx.write = async () => { throw Error('Serialization failed'); };"}],
  ]) {
    const output = join(cwd, `${name}.pptx`);
    failure(await invoke({cwd, output, ...inputs}));
    assert.equal(existsSync(output), false);
  }
  const existing = join(cwd, 'existing.pptx');
  const original = Buffer.from('An existing file must survive');
  await writeFile(existing, original);
  failure(await invoke({cwd, output: existing, prompt: source}));
  assert.deepEqual(await readFile(existing), original);
  const alias = join(cwd, 'alias.pptx');
  await symlink(existing, alias);
  failure(await invoke({cwd, output: alias, prompt: source}));
  assert.equal(await readlink(alias), existing);
  assert.deepEqual(await readFile(existing), original);
  const missing = join(cwd, 'absent.pptx');
  const dangling = join(cwd, 'dangling.pptx');
  await symlink(missing, dangling);
  failure(await invoke({cwd, output: dangling, prompt: source}));
  assert.equal(await readlink(dangling), missing);
  assert.equal(existsSync(missing), false);
});

test('concurrent writers create one complete output without overwriting each other', async () => {
  const output = join(directory, 'concurrent.pptx');
  const results = await Promise.all(['first', 'second'].map(text => invoke({output, prompt: `await new Promise(resolve => setTimeout(resolve, 50)); pptx.addSlide().addText('${text}', {x: 1, y: 1, w: 4, h: 1});`})));
  assert.equal(results.filter(result => result.code === 0).length, 1);
  const winner = results.findIndex(result => result.code === 0);
  assert.deepEqual(success(results[winner]), {output});
  failure(results[1 - winner]);
  const xml = await (await archive(output)).file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, new RegExp(winner === 0 ? 'first' : 'second'));
  assert.doesNotMatch(xml, new RegExp(winner === 0 ? 'second' : 'first'));
});
