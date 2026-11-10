// Level checker: proves every level in index.html can be beaten.
// It copies the game's physics and hitboxes (fixed 1/120 s steps) and searches for a winning run,
// with input only allowed to change on screen frames at 30, 60 and 120 fps.
// usage:  node tools/check-levels.js            (checks ./index.html)
//         node tools/check-levels.js index.html neon-rush   to check just one level (by id)
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'index.html'), 'utf8');
const LEVELS = new Function(src.slice(src.indexOf('// LEVELS-START'), src.indexOf('// LEVELS-END')) + '; return LEVELS;')();
const SPEED_TIERS = src.includes('// SPEED-TIERS-START')
  ? new Function(src.slice(src.indexOf('// SPEED-TIERS-START'), src.indexOf('// SPEED-TIERS-END')) + '; return SPEED_TIERS;')() : {};
const num = name => Number(new RegExp('const ' + name + ' = (-?[\\d.]+)').exec(src)[1]);
const CUBE = num('CUBE'), INNER = num('INNER'), GRAVITY = num('GRAVITY'), JUMP_V = num('JUMP_V');
const SPIKE_HB_W = num('SPIKE_HB_W'), SPIKE_HB_H = num('SPIKE_HB_H'), SPIKE_HB_TOP = num('SPIKE_HB_TOP'), RUNWAY = num('RUNWAY');
const SHIP_GRAVITY = num('SHIP_GRAVITY'), SHIP_LIFT = num('SHIP_LIFT'), SHIP_MAX = num('SHIP_MAX'), CORRIDOR = num('CORRIDOR');
const THORN_HB = num('THORN_HB'), THORN_GAP = num('THORN_GAP');
const SLAB_H = num('SLAB_H'), SLAB_LOW = num('SLAB_LOW'), SLAB_HIGH = num('SLAB_HIGH');
const SLOPE_SPIKE_HB = num('SLOPE_SPIKE_HB'), WAVE_SAFE = num('WAVE_SAFE');
const BALL_GRAVITY = num('BALL_GRAVITY'), BALL_KICK = num('BALL_KICK'), BALL_MAX = num('BALL_MAX');
const GROUND_Y = 420, PX = 180, DT = 1 / 120;

function build(map, ceil = '') {
  const obs = [], portals = [], startX = PX + RUNWAY, ceilY = GROUND_Y - CORRIDOR;
  let shipFrom = null, shipKind = '', waveF = 0, waveC = 0;
  [...ceil].forEach((c, i) => {
    const x = startX + i * 40, h = { '1': 40, '2': 80, '3': 120, A: 40, B: 80 }[c];
    if (h) obs.push({ t: 'b', x, w: 40, h, y: ceilY });
    if (c === '^') obs.push({ t: 's', flip: true, x, w: 40, h: 40, y: ceilY });
    if (c === 'A' || c === 'B') obs.push({ t: 's', flip: true, x, w: 40, h: 40, y: ceilY + h });
  });
  [...map].forEach((c, i) => {
    const x = startX + i * 40, h = { '1': 40, '2': 80, '3': 120, A: 40, B: 80 }[c];
    if (h) obs.push({ t: 'b', x, w: 40, h, y: GROUND_Y - h });
    const slab = { _: SLAB_LOW, '+': SLAB_LOW, '=': SLAB_HIGH }[c];
    if (slab) obs.push({ t: 'b', x, w: 40, h: SLAB_H, y: GROUND_Y - slab });
    if (c === '^' || c === '+') obs.push({ t: 's', x, w: 40, h: 40, y: GROUND_Y - 40 });
    if (c === 'A' || c === 'B') obs.push({ t: 's', x, w: 40, h: 40, y: GROUND_Y - h - 40 });
    if (SPEED_TIERS[c]) portals.push({ x, speed: SPEED_TIERS[c] });
    if (c === 'u' || c === 'd') portals.push({ x, grav: c === 'u' ? -1 : 1 });
    if (c === '[' || c === '(' || c === 'w' || c === ']') portals.push({ x, mode: { '[': 'ship', '(': 'ball', w: 'wave', ']': 'cube' }[c] });
    if (c === '[' || c === '(' || c === 'w') { shipFrom = x; shipKind = c; }
    if (shipKind === 'w' && shipFrom !== null) { // wave tunnel floor/ceiling pieces (sloped or flat), lined with spikes
      const cc = ceil[i], k = (x - shipFrom) / 40, f0 = waveF, c0 = waveC;
      if (c === '/') waveF += 40; else if (c === '\\') waveF -= 40;
      if (cc === '\\') waveC += 40; else if (cc === '/') waveC -= 40;
      obs.push({ t: 'tf', x, w: 40, h0: f0, h1: waveF, safe: k < WAVE_SAFE || c === ']' });
      obs.push({ t: 'tc', x, w: 40, h0: c0, h1: waveC, safe: c === ']' });
    }
    if (c === ']') waveF = waveC = 0;  // ground spikes along each ship section's floor
    if (c === ']' && shipFrom !== null && shipKind === '[') { obs.push({ t: 'g', x: shipFrom + THORN_GAP, w: x + 40 - shipFrom - THORN_GAP, y: GROUND_Y - THORN_HB, h: THORN_HB }); }
    if (c === ']') shipFrom = null;
  });
  return { obs, portals, finishX: startX + (map.length + 4) * 40 };
}
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function terrainHit(b, o) {
  const xs = Math.max(b.x, o.x), xe = Math.min(b.x + b.w, o.x + o.w);
  if (xs >= xe) return false;
  const at = x => o.h0 + (o.h1 - o.h0) * (x - o.x) / o.w, hmax = Math.max(at(xs), at(xe));
  if (o.safe && hmax === 0) return false;
  return o.t === 'tf' ? b.y + b.h > GROUND_Y - hmax - SLOPE_SPIKE_HB : b.y < GROUND_Y - CORRIDOR + hmax + SLOPE_SPIKE_HB;
}
const sbox = s => ({ x: s.x + (s.w - SPIKE_HB_W) / 2, y: s.flip ? s.y + s.h - SPIKE_HB_TOP - SPIKE_HB_H : s.y + SPIKE_HB_TOP, w: SPIKE_HB_W, h: SPIKE_HB_H });

// one physics step of the game's update() in mode m ('cube' | 'ship' | 'ball'); returns null on crash.
// p.gr is the gravity direction (1 = down, -1 = up), flipped by the ball or by gravity portals.
function phys(p, off, hold, obs, m, spd) {
  p = { ...p };
  const ship = m === 'ship', ball = m === 'ball', wave = m === 'wave';
  if (wave) p.vy = (hold ? -1 : 1) * spd * p.gr;
  else if (ship) p.vy = Math.max(-SHIP_MAX, Math.min(SHIP_MAX, p.vy + (hold ? -SHIP_LIFT : SHIP_GRAVITY) * p.gr * DT));
  else if (ball) {
    if (hold && p.g) { p.gr = -p.gr; p.vy = p.gr * BALL_KICK; p.g = false; }
    p.vy = Math.max(-BALL_MAX, Math.min(BALL_MAX, p.vy + BALL_GRAVITY * p.gr * DT));
  } else { if (hold && p.g) { p.vy = JUMP_V * p.gr; p.g = false; } p.vy += GRAVITY * p.gr * DT; }
  p.y += p.vy * DT; p.g = false;
  if (p.y + CUBE >= GROUND_Y) { p.y = GROUND_Y - CUBE; p.vy = 0; p.g = p.gr > 0; }
  if ((ship || ball || wave || p.gr < 0) && p.y <= GROUND_Y - CORRIDOR) { p.y = GROUND_Y - CORRIDOR; p.vy = Math.max(0, p.vy); if (p.gr < 0) p.g = true; }
  const outer = () => ({ x: PX, y: p.y, w: CUBE, h: CUBE }), inner = () => ({ x: PX + INNER, y: p.y + INNER, w: CUBE - 2 * INNER, h: CUBE - 2 * INNER });
  for (const o0 of obs) {
    if (o0.t !== 'b' || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    const o = { ...o0, x: o0.x - off };
    if (!ov(outer(), o)) continue;
    if (wave) { if (ov(inner(), o)) return null; continue; }
    if (p.vy >= 0 && p.y + CUBE - o.y <= INNER) { p.y = o.y - CUBE; p.vy = 0; p.g = p.gr > 0; }
    else if ((ship || ball || p.gr < 0) && p.vy <= 0 && o.y + o.h - p.y <= INNER) { p.y = o.y + o.h; p.vy = 0; if (p.gr < 0) p.g = true; }
    else if (ov(inner(), o)) return null;
  }
  for (const o0 of obs) {
    if (o0.t !== 's' || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    if (ov(inner(), sbox({ ...o0, x: o0.x - off }))) return null;
  }
  for (const o0 of obs) {
    if (o0.t !== 'g' || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    if (ov(inner(), { ...o0, x: o0.x - off })) return null;
  }
  for (const o0 of obs) {
    if ((o0.t !== 'tf' && o0.t !== 'tc') || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    if (terrainHit(inner(), { ...o0, x: o0.x - off })) return null;
  }
  return p;
}

function analyse(lv, K) {
  const { obs, portals, finishX } = build(lv.map, lv.ceil);
  // How far the world has scrolled after each physics step. This doesn't depend on the player,
  // so it's worked out once: move by the current speed, then any portal the cube's centre has
  // passed sets the speed for the next step (same order as the game's update()).
  // Mode portals (ship / ball / cube) work the same way, so modes[s] is the mode for step s,
  // and gravs[s] is the gravity a gravity portal sets at step s (if any).
  const offs = [0], modes = ['cube'], gravs = [0];
  let speed = lv.speed, mode = 'cube', pi = 0, endStep = 0;
  while (offs[offs.length - 1] < finishX - PX) {
    const off = offs[offs.length - 1] + speed * DT;
    offs.push(off);
    let gset = 0;
    while (pi < portals.length && portals[pi].x + 20 - off <= PX + CUBE / 2) {
      const pt = portals[pi++];
      if (pt.speed) speed = pt.speed; else if (pt.grav) gset = pt.grav; else mode = pt.mode;
    }
    modes.push(mode); gravs.push(gset);
  }
  endStep = offs.length - 1;
  // the few obstacles near the cube at each step (so a step doesn't scan the whole level)
  const near = offs.map(off => obs.filter(o => !(o.x - off > PX + 60 || o.x + o.w - off < PX - 20)));
  const dx = lv.speed * DT; // only used to report roughly where a level gets stuck
  // apply one screen frame (K physics steps) with the key held or not
  const frame = (n, p, hold) => {
    for (let k = 0; k < K; k++) {
      const s = n * K + k;
      if (s >= endStep) return { p, done: true };
      if (modes[s + 1] !== modes[s]) p = { ...p, gr: 1 }; // going through a mode portal resets gravity
      if (gravs[s + 1] && gravs[s + 1] !== p.gr) p = { ...p, gr: gravs[s + 1], g: false };
      p = phys(p, offs[s + 1], hold, near[s + 1], modes[s + 1], (offs[s + 1] - offs[s]) / DT);
      if (!p) return null;
    }
    return { p, done: (n + 1) * K >= endStep };
  };
  // Sweep forward one screen frame at a time, keeping every distinct state the cube/ship can be in.
  // Ship states are grouped into 1px x 20px/s buckets (one real, exactly simulated state is kept
  // per bucket), so a "possible" answer is always a real run; grouping only keeps the search small.
  const key = (p, ship) => ship ? Math.round(p.y) + ':' + Math.round(p.vy / 20) + ':' + p.g + ':' + p.gr
                                : p.y.toFixed(2) + ':' + p.vy.toFixed(1) + ':' + p.g + ':' + p.gr;
  let front = [{ y: GROUND_Y - CUBE, vy: 0, g: true, gr: 1 }], n = 0;
  while (front.length) {
    const next = new Map(), ship = modes[(n + 1) * K] === 'ship' || modes[n * K + 1] === 'ship';
    for (const p of front) {
      for (const hold of [false, true]) {
        const r = frame(n, p, hold);
        if (!r) continue;
        if (r.done) return { ok: true };
        const k = key(r.p, ship);
        if (!next.has(k)) next.set(k, r.p);
      }
    }
    front = [...next.values()];
    if (front.length) n++;
  }
  const col = Math.max(0, Math.floor((offs[Math.min(offs.length - 1, n * K)] - RUNWAY) / 40));
  return { ok: false, where: `stuck near column ${col}: "${lv.map.slice(Math.max(0, col - 4), col + 6)}"` };
}

for (const lv of LEVELS.filter(l => !process.argv[3] || process.argv.slice(3).includes(l.id))) {
  const row = [lv.name.padEnd(14)];
  for (const [fps, K] of [[30, 4], [60, 2], [120, 1]]) {
    const r = analyse(lv, K);
    row.push(`${fps}fps: ${r.ok ? 'possible' : 'IMPOSSIBLE (' + r.where + ')'}`);
  }
  console.log(row.join(' | '));
}
