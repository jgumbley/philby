const owner = Number(process.argv[2]);
const caller = Number(process.argv[3]);
if (![owner, caller].every(pid => Number.isSafeInteger(pid) && pid > 0)) throw Error('Invalid browser watchdog process');

function stop(message: string) {
  console.error(message);
  try { process.kill(owner, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  process.exit(1);
}

const deadline = setTimeout(() => stop('Browser script exceeded 120 seconds; unfinished work terminated'), 120000);
const monitor = setInterval(() => {
  try { process.kill(caller, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') stop('Browser caller exited; unfinished work terminated');
    else throw error;
  }
}, 250);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => stop(`Browser pane interrupted by ${signal}; unfinished work terminated`));
process.stdin.resume();
process.stdin.on('end', () => {
  clearTimeout(deadline);
  clearInterval(monitor);
  process.exit(0);
});
process.stdout.write('ready\n');
