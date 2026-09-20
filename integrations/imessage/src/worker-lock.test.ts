import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {acquireWorkerLock} from './worker-lock';

test('worker recovers a definitely exited PID and refuses running or malformed locks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ginger-lock-')); const file = join(dir, 'worker.lock');
  try {
    await writeFile(file, String(process.pid)); await assert.rejects(acquireWorkerLock(file), /running/);
    await writeFile(file, 'not-a-pid'); await assert.rejects(acquireWorkerLock(file), /valid PID/);
    const child = spawnSync(process.execPath, ['-e', '']);
    await writeFile(file, String(child.pid)); const lock = await acquireWorkerLock(file); await lock.close();
  } finally {await rm(dir, {recursive: true, force: true});}
});
