import { readFileSync } from 'node:fs';

try {
  const path=process.argv[2];
  if(!path) throw Error('Missing launch environment');
  let environment:unknown;
  try {environment=JSON.parse(readFileSync(path,'utf8'));}
  catch {throw Error('Cannot read launch environment');}
  if(!environment || typeof environment!=='object' || Array.isArray(environment) || Object.values(environment).some(value=>typeof value!=='string')) throw Error('Invalid launch environment');
  const terminal=Object.fromEntries(['TERM','TMUX','TMUX_PANE'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  for(const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env,environment,terminal);
  process.argv.splice(2,1);
  await import('./cli.js');
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}
