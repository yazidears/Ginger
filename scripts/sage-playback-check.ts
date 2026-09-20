import assert from 'node:assert/strict';
import {playbackMinute, timelineStops} from '../src/lib/sage/playback';
// Identical elapsed time produces identical model time regardless of scheduling.
assert.equal(playbackMinute(10, 5000, 6, 120), 40);
assert.equal(playbackMinute(playbackMinute(10, 2000, 6, 120), 3000, 6, 120), 40);
assert.equal(playbackMinute(10, 5000, 12, 120), 70);
assert.equal(playbackMinute(119, 5000, 6, 120), 120);
assert.equal(playbackMinute(10, -5000, 6, 120), 10);
assert.deepEqual(timelineStops(120), [0, 30, 60, 120]);
assert.deepEqual(timelineStops(240), [0, 30, 60, 120, 180, 240]);
console.log('Sage playback: elapsed-time, speed, bounds and timeline checks passed.');
