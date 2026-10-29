import { lstat, open, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import PptxGenJS from 'pptxgenjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function script() {
  const { PROMPT_FILE, PROMPT } = process.env;
  if (!PROMPT_FILE && !PROMPT && process.stdin.isTTY) throw Error('Supply PROMPT_FILE, prompt, or stdin');
  const source = PROMPT_FILE ? readFileSync(PROMPT_FILE, 'utf8') : PROMPT || readFileSync(0, 'utf8');
  if (!source.trim()) throw Error('A nonempty slide script is required');
  return new AsyncFunction('pptx', source);
}

async function diagnose() {
  const pptx = new PptxGenJS();
  pptx.addSlide().addText('Philby', { x: 1, y: 1, w: 3, h: 1 });
  await pptx.write({ outputType: 'nodebuffer' });
  console.log(JSON.stringify({ node: process.version, pptxgenjs: pptx.version, serialization: 'ok' }));
}

async function generate() {
  if (!process.env.OUTPUT) throw Error('OUTPUT is required: a new .pptx file');
  const output = resolve(process.env.OUTPUT);
  if (extname(output).toLowerCase() !== '.pptx') throw Error('OUTPUT must be a .pptx file');
  try {
    await lstat(output);
    throw Error('OUTPUT already exists; choose a new .pptx file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!(await stat(dirname(output))).isDirectory()) throw Error('OUTPUT directory does not exist');
  const build = script();
  const pptx = new PptxGenJS();
  const stdoutWrite = process.stdout.write;
  let data;
  try {
    process.stdout.write = process.stderr.write.bind(process.stderr);
    await build(pptx);
    data = await pptx.write({ outputType: 'nodebuffer' });
  } finally {
    process.stdout.write = stdoutWrite;
  }
  const file = await open(output, 'wx', 0o600);
  try {
    await file.writeFile(data);
  } catch (error) {
    await rm(output);
    throw error;
  } finally {
    await file.close();
  }
  console.log(JSON.stringify({ output }));
}

try {
  if (process.argv[2] === 'diagnose') await diagnose();
  else if (process.argv[2] === 'generate') await generate();
  else throw Error('Expected generate or diagnose');
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
}
