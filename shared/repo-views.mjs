import { execFileSync } from 'node:child_process';

const tmux=(...args)=>execFileSync('tmux',args,{encoding:'utf8'});
const rows=tmux('list-panes','-a','-F','#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{window_name}\t#{pane_current_command}\t#{pane_current_path}').trim().split('\n');
for(const row of rows) {
  const [target,id,window,command,directory]=row.split('\t');
  const view={target,id,window,command,directory};
  if(command==='lazygit') {
    view.repository=execFileSync('git',['-C',directory,'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
  }
  console.log(JSON.stringify(view));
}
