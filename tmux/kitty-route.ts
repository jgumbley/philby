import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Pane = {socket:string;pane:string;tty:string};

function tmux(socket:string,args:string[]) {
  const result=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',timeout:3000});
  if(result.error) throw result.error;
  if(result.status!==0) throw Error(result.stderr.trim() || `tmux exited ${result.status}`);
  return result.stdout.trim();
}

function enclosingPanes(socket:string,pane:string) {
  const panes:Pane[]=[];
  for(const entry of readdirSync(dirname(socket),{withFileTypes:true}).filter(entry=>entry.isSocket())) {
    const path=join(dirname(socket),entry.name);
    let rows:string;
    try {rows=tmux(path,['list-panes','-a','-F','#{pane_id}\t#{pane_tty}']);}
    catch(error) {
      if(path!==socket && /^(no server running on |error connecting to .* \((No such file or directory|Connection refused)\))/.test(String((error as Error).message))) continue;
      throw error;
    }
    for(const row of rows.split('\n').filter(Boolean)) {
      const [id,tty]=row.split('\t');
      panes.push({socket:path,pane:id,tty});
    }
  }
  const route:Pane[]=[];
  let current:Pane|undefined=panes.find(item=>item.socket===socket && item.pane===pane);
  if(!current) throw Error('Cannot find the launching tmux pane for Kitty navigation');
  while(current) {
    if(route.includes(current)) throw Error('Circular tmux attachment route');
    route.push(current);
    if(tmux(current.socket,['display-message','-p','-t',current.pane,'#{window_linked}'])==='1') throw Error('Kitty navigation cannot configure a tmux window linked to multiple sessions');
    const session=tmux(current.socket,['display-message','-p','-t',current.pane,'#{session_id}']);
    const clients:string[]=tmux(current.socket,['list-clients','-t',session,'-F','#{client_tty}']).split('\n').filter(Boolean);
    if(clients.length!==1) throw Error('Kitty navigation requires exactly one attached client per enclosing tmux session');
    const parents:Pane[]=panes.filter(item=>item.tty===clients[0]);
    if(parents.length>1) throw Error('Cannot identify a unique enclosing tmux pane for Kitty navigation');
    current=parents[0];
  }
  return route;
}

export async function withTmuxPassthrough<T>(run:(depth:number)=>Promise<T>,env:NodeJS.ProcessEnv=process.env):Promise<T> {
  if(!env.TMUX) return run(0);
  if(!env.TMUX_PANE) throw Error('TMUX_PANE is required for Kitty navigation');
  const route=enclosingPanes(env.TMUX.split(',')[0],env.TMUX_PANE);
  const changed:{socket:string;pane:string;previous:string}[]=[];
  let failure:unknown;
  try {
    for(const {socket,pane} of route) {
      const previous=tmux(socket,['show-options','-p','-v','-t',pane,'allow-passthrough']);
      tmux(socket,['set-option','-p','-t',pane,'allow-passthrough','on']);
      changed.push({socket,pane,previous});
    }
    return await run(route.length);
  } catch(error) {failure=error;throw error;}
  finally {
    const errors:unknown[]=[];
    for(const {socket,pane,previous} of changed.reverse()) {
      try {tmux(socket,previous ? ['set-option','-p','-t',pane,'allow-passthrough',previous] : ['set-option','-pu','-t',pane,'allow-passthrough']);}
      catch(error) {errors.push(error);}
    }
    if(errors.length) throw new AggregateError(failure?[failure,...errors]:errors,'Failed to restore tmux passthrough after Kitty navigation setup');
  }
}
