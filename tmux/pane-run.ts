import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

export async function runPane(id:string,name:string,target:string,source:string,onSpawn:()=>void) {
  if(!process.stdin.isTTY || !process.env.TMUX_PANE || process.env.PHILBY_FRAME!==id || !process.env.PHILBY_ROOT) throw Error('Pane requires its owning frame and a tmux terminal');
  const args=['--no-print-directory',...(source==='shared'?['-f',join(process.env.PHILBY_ROOT,'shared','Makefile')]:[]),'--',target];
  const interrupt=()=>{};
  process.on('SIGINT',interrupt);
  let started=false;
  try {
    for(;;) {
      const result=await new Promise<string>((resolve,reject)=>{
        const command=spawn('make',args,{stdio:'inherit'});
        command.once('error',reject);
        command.once('spawn',()=>{
          if(!started) {onSpawn();started=true;}
        });
        command.once('exit',(code,signal)=>resolve(signal?`signal ${signal}`:`exit code ${code}`));
      });
      const input=createInterface({input:process.stdin,output:process.stdout});
      try {await input.question(`\n${name}: ${target} finished (${result}). Press Enter to rerun. `);}
      finally {input.close();}
    }
  } finally {process.off('SIGINT',interrupt);}
}
