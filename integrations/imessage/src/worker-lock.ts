import {mkdir, open, readFile, rmdir, unlink} from 'node:fs/promises';

export async function acquireWorkerLock(path: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(path, 'wx', 0o600);
      await lock.writeFile(String(process.pid));
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt) throw error;
      // Only one contender can recover a stale lock; a simultaneous recovery must never unlink a new worker's lock.
      const recovery = `${path}.recovery`;
      await mkdir(recovery, {mode: 0o700}).catch(() => {throw new Error('Messaging lock recovery is in progress. Inspect a stale worker.lock.recovery directory before removing it.');});
      try {
        const value = await readFile(path, 'utf8');
        const pid = Number(value.trim());
        if (!Number.isInteger(pid) || pid <= 1) throw new Error('Messaging worker lock has no valid PID; inspect it before removing it.');
        try {process.kill(pid, 0);}
        catch (probe) {
          if ((probe as NodeJS.ErrnoException).code === 'ESRCH') {
            if (await readFile(path, 'utf8') !== value) throw new Error('Messaging worker lock changed; retry startup.');
            await unlink(path); continue;
          }
          throw probe;
        }
        throw new Error('Another messaging worker is running. Stop it before starting a new worker.');
      } finally {await rmdir(recovery);}
    }
  }
  throw new Error('Unable to acquire messaging worker lock');
}
