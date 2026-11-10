import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
if (mode === 'status') {
  const { slug, pid, work } = JSON.parse(readFileSync(0, 'utf8'));
  console.log(JSON.stringify({ slug, pid, scheduling: work.scheduling, tasks: work.tasks.map(t => ({ id: t.record.id, kind: t.record.kind, startedAt: t.record.startedAt, status: t.state.status, phase: t.state.checkpoint?.phase, until: t.state.checkpoint?.until })), submissions: work.submissions.map(s => ({ id: s.id, status: s.status, type: s.type })) }, null, 2));
} else {
  const args = process.env.SOCKET ? ['-L', process.env.SOCKET] : [];
  if (mode === 'views') args.push('list-panes', '-a', '-F', '#{session_name}:#{window_index}.#{pane_index}\t#{pane_id}\t#{window_name}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}');
  else if (mode === 'screen') {
    if (!process.env.TARGET) throw Error('TARGET is required');
    args.push('capture-pane', '-p', '-t', process.env.TARGET);
  } else throw Error(`Unknown inspection: ${mode}`);
  const output = execFileSync('tmux', args, { encoding: 'utf8' });
  console.log(mode === 'screen' ? output.split('\n').map(line => line.replace(/[│·\s]+$/u, '')).filter(line => /[\p{L}\p{N}]/u.test(line)).slice(-40).join('\n') : output.trimEnd());
}
