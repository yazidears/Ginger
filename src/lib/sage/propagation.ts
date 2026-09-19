/** Cell-centre travel stencils. Longer edges must inspect every crossed cell. */
export type TravelEdge = {
  dx: number; dy: number; distance: number; bearing: number;
  segments: {dx: number; dy: number; fraction: number}[];
  guards: {dx: number; dy: number}[];
};

export function travelEdge(dx: number, dy: number): TravelEdge {
  const cuts = [0, 1];
  for (const v of [dx, dy]) {
    for (let k = .5; k < Math.abs(v); k++) cuts.push(k / Math.abs(v));
  }
  const times = [...new Set(cuts)].sort((a, b) => a - b);
  const segments = times.slice(1).map((t, i) => ({
    dx: Math.floor(dx * (t + times[i]) / 2 + .5),
    dy: Math.floor(dy * (t + times[i]) / 2 + .5),
    fraction: t - times[i],
  }));
  const guards = segments.map(({dx, dy}) => ({dx, dy}));
  // A diagonal must not slip through the point where two blocked cells meet.
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1], b = segments[i];
    if (a.dx !== b.dx && a.dy !== b.dy) {
      guards.push({dx: a.dx, dy: b.dy}, {dx: b.dx, dy: a.dy});
    }
  }
  return {dx, dy, distance: Math.hypot(dx, dy), bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, segments, guards};
}

export function travelStencil(mode: 'legacy8' | 'ginger16') {
  const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  if (mode === 'ginger16') offsets.push([-2,-1],[-2,1],[2,-1],[2,1],[-1,-2],[1,-2],[-1,2],[1,2]);
  return offsets.map(([x, y]) => travelEdge(x, y));
}

export function edgeIsOpen(edge: TravelEdge, x: number, y: number, size: number, fuel: ArrayLike<number>) {
  return edge.guards.every(p => {
    const nx = x + p.dx, ny = y + p.dy;
    return nx >= 0 && ny >= 0 && nx < size && ny < size && fuel[ny * size + nx] > 0;
  });
}
