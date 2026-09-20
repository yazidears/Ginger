/** Model minutes are derived from monotonic elapsed time, never rendered frames. */
export function playbackMinute(startMinute: number, elapsedMs: number, speed: number, horizon: number) {
  return Math.min(horizon, Math.max(0, startMinute + Math.max(0, elapsedMs) * speed / 1000));
}

export function timelineStops(horizon: number) {
  return [0, 30, 60, 120, 180, 240].filter(minute => minute <= horizon);
}
