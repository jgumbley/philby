import { access, lstat, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const languagePath = join(dirname(fileURLToPath(import.meta.resolve('@tesseract.js-data/eng'))), '4.0.0');

async function diagnose() {
  const { createCanvas } = await import('@scribe.js/canvas');
  const canvas = createCanvas(1, 1);
  await canvas.encode('png');
  await access(join(languagePath, 'eng.traineddata.gz'));
  const manifest = JSON.parse(await readFile(new URL('../../node_modules/scribe.js-ocr/package.json', import.meta.url), 'utf8'));
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, scribe: manifest.version, language: 'eng', rendering: 'ok' }));
}

async function run() {
  if (!process.env.INPUT) throw Error('INPUT is required: a local PDF, PNG or JPEG file');
  const input = resolve(process.env.INPUT);
  const output = process.env.OUTPUT ? resolve(process.env.OUTPUT) : null;
  const extension = extname(input).toLowerCase();
  if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) throw Error('INPUT must be a PDF, PNG or JPEG file');
  if (!(await stat(input)).isFile()) throw Error('INPUT must be a file');
  if (output) {
    try {
      await lstat(output);
      throw Error('OUTPUT already exists; choose a new text file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!(await stat(dirname(output))).isDirectory()) throw Error('OUTPUT directory does not exist');
  }
  const file = await open(input, 'r');
  const header = Buffer.alloc(8);
  try {
    await file.read(header, 0, header.length, 0);
  } finally {
    await file.close();
  }
  const valid = extension === '.pdf' ? header.subarray(0, 5).toString() === '%PDF-'
    : extension === '.png' ? header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!valid) throw Error('INPUT contents do not match its file type');
  await access(join(languagePath, 'eng.traineddata.gz'));
  const cwd = process.cwd();
  const scratch = await mkdtemp(join(tmpdir(), 'philby-ocr-'));
  const stdoutWrite = process.stdout.write;
  let scribe;
  let text;
  try {
    process.chdir(scratch);
    process.stdout.write = process.stderr.write.bind(process.stderr);
    await writeFile(join(scratch, 'eng.traineddata'), gunzipSync(await readFile(join(languagePath, 'eng.traineddata.gz'))));
    scribe = (await import('scribe.js-ocr')).default;
    scribe.opt.langPath = languagePath;
    scribe.opt.workerN = 2;
    const errors = [];
    scribe.opt.errorHandler = message => { errors.push(String(message)); console.error(message); };
    const completed = new Set();
    scribe.opt.progressHandler = ({ type, n }) => {
      if (type === 'recognize' && Number.isInteger(n) && !completed.has(n)) {
        completed.add(n);
        console.error(`OCR: recognised page ${n + 1}`);
      }
    };
    console.error('OCR: reading document');
    const doc = await scribe.openDocument([input]);
    if (errors.length) throw Error(errors.join('\n'));
    if (!doc.inputData.pageCount) throw Error('No pages found in INPUT');
    await doc.recognize({ langs: ['eng'], ocrPages: 'autoShallow' });
    if (errors.length) throw Error(errors.join('\n'));
    const pages = [];
    for (let i = 0; i < doc.inputData.pageCount; i++) {
      pages.push((await doc.exportData('text', { pageArr: [i], reflow: false })).trim());
    }
    if (errors.length) throw Error(errors.join('\n'));
    if (!pages.some(page => page.length)) throw Error('No text found in INPUT');
    text = pages.join('\n\f\n') + '\n';
    console.error(`OCR: extracted ${pages.length} page(s)`);
  } finally {
    try {
      if (scribe) await scribe.terminate();
    } finally {
      process.stdout.write = stdoutWrite;
      process.chdir(cwd);
      await rm(scratch, { recursive: true, force: true });
    }
  }
  if (output) await writeFile(output, text, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(text);
}

try {
  if (process.argv[2] === 'diagnose') await diagnose();
  else if (process.argv[2] === 'run') await run();
  else throw Error('Expected run or diagnose');
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
}
