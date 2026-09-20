'use client';
import {useEffect, useRef} from 'react';
import {playbackMinute} from '@/lib/sage/playback';

/** Six UI updates/second; geographic filtering is handled by the map's GPU. */
export function useSagePlayback({playing, minute, horizon, speed, onMinute, onPause}: {
  playing: boolean; minute: number; horizon: number; speed: number;
  onMinute: (minute: number) => void; onPause: () => void;
}) {
  const latest = useRef({minute, onMinute, onPause});
  latest.current = {minute, onMinute, onPause};
  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now(), origin = latest.current.minute;
    const tick = () => {
      const next = playbackMinute(origin, performance.now() - startedAt, speed, horizon);
      latest.current.onMinute(Math.round(next * 10) / 10);
      if (next >= horizon) latest.current.onPause();
    };
    const stopWhenHidden = () => { if (document.hidden) latest.current.onPause(); };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => { if (reduced.matches) latest.current.onPause(); };
    const timer = window.setInterval(tick, 160);
    document.addEventListener('visibilitychange', stopWhenHidden);
    reduced.addEventListener('change', preferenceChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', stopWhenHidden);
      reduced.removeEventListener('change', preferenceChanged);
    };
  }, [playing, horizon, speed]);
}
