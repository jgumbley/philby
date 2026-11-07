import { spawnSync } from 'node:child_process';
import { root, piAgentDir } from '../dist/src/config.js';

try {
  const result=spawnSync('npx',['--no-install','pi'],{cwd:root,stdio:'inherit',env:{...process.env,PI_CODING_AGENT_DIR:piAgentDir}});
  if(result.error) throw result.error;
  if(result.signal) process.kill(process.pid,result.signal);
  else process.exitCode=result.status ?? 1;
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=1;
}
