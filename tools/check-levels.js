// Level checker: proves every level in index.html can be beaten.
// It copies the game's physics and hitboxes (fixed 1/120 s steps) and searches for a winning run,
// with input only allowed to change on screen frames at 30, 60 and 120 fps.
// usage:  node tools/check-levels.js            (checks ./index.html)
//         node --stack-size=65500 tools/check-levels.js   if a long level overflows the stack
//         node tools/check-levels.js index.html neon-rush   to check just one level (by id)
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'index.html'), 'utf8');
const LEVELS = new Function(src.slice(src.indexOf('// LEVELS-START'), src.indexOf('// LEVELS-END')) + '; return LEVELS;')();
const SPEED_TIERS = src.includes('// SPEED-TIERS-START')
  ? new Function(src.slice(src.indexOf('// SPEED-TIERS-START'), src.indexOf('// SPEED-TIERS-END')) + '; return SPEED_TIERS;')() : {};
const num = name => Number(new RegExp('const ' + name + ' = (-?[\\d.]+)').exec(src)[1]);
const CUBE = num('CUBE'), INNER = num('INNER'), GRAVITY = num('GRAVITY'), JUMP_V = num('JUMP_V');
const SPIKE_HB_W = num('SPIKE_HB_W'), SPIKE_HB_H = num('SPIKE_HB_H'), SPIKE_HB_TOP = num('SPIKE_HB_TOP'), RUNWAY = num('RUNWAY');
const GROUND_Y = 420, PX = 180, DT = 1 / 120;

function build(map) {
  const obs = [], portals = [], startX = PX + RUNWAY;
  [...map].forEach((c, i) => {
    const x = startX + i * 40, h = { '1': 40, '2': 80, '3': 120, A: 40, B: 80 }[c];
    if (h) obs.push({ t: 'b', x, w: 40, h, y: GROUND_Y - h });
    if (c === '^') obs.push({ t: 's', x, w: 40, h: 40, y: GROUND_Y - 40 });
    if (c === 'A' || c === 'B') obs.push({ t: 's', x, w: 40, h: 40, y: GROUND_Y - h - 40 });
    if (SPEED_TIERS[c]) portals.push({ x, speed: SPEED_TIERS[c] });
  });
  return { obs, portals, finishX: startX + (map.length + 4) * 40 };
}
const ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const sbox = s => ({ x: s.x + (s.w - SPIKE_HB_W) / 2, y: s.y + SPIKE_HB_TOP, w: SPIKE_HB_W, h: SPIKE_HB_H });

// one physics step of the game's update(); returns null on crash
function phys(p, off, hold, obs) {
  p = { ...p };
  if (hold && p.g) { p.vy = JUMP_V; p.g = false; }
  p.vy += GRAVITY * DT; p.y += p.vy * DT; p.g = false;
  if (p.y + CUBE >= GROUND_Y) { p.y = GROUND_Y - CUBE; p.vy = 0; p.g = true; }
  const outer = () => ({ x: PX, y: p.y, w: CUBE, h: CUBE }), inner = () => ({ x: PX + INNER, y: p.y + INNER, w: CUBE - 2 * INNER, h: CUBE - 2 * INNER });
  for (const o0 of obs) {
    if (o0.t !== 'b' || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    const o = { ...o0, x: o0.x - off };
    if (!ov(outer(), o)) continue;
    if (p.vy >= 0 && p.y + CUBE - o.y <= INNER) { p.y = o.y - CUBE; p.vy = 0; p.g = true; }
    else if (ov(inner(), o)) return null;
  }
  for (const o0 of obs) {
    if (o0.t !== 's' || o0.x - off > PX + 60 || o0.x + o0.w - off < PX - 20) continue;
    if (ov(inner(), sbox({ ...o0, x: o0.x - off }))) return null;
  }
  return p;
}

function analyse(lv, K) {
  const { obs, portals, finishX } = build(lv.map);
  // How far the world has scrolled after each physics step. This doesn't depend on the player,
  // so it's worked out once: move by the current speed, then any portal the cube's centre has
  // passed sets the speed for the next step (same order as the game's update()).
  const offs = [0];
  let speed = lv.speed, pi = 0, endStep = 0;
  while (offs[offs.length - 1] < finishX - PX) {
    const off = offs[offs.length - 1] + speed * DT;
    offs.push(off);
    while (pi < portals.length && portals[pi].x + 20 - off <= PX + CUBE / 2) speed = portals[pi++].speed;
  }
  endStep = offs.length - 1;
  const dx = lv.speed * DT; // only used to report roughly where a level gets stuck
  // apply one screen frame (K physics steps) with the key held or not
  const frame = (n, p, hold) => { for (let k = 0; k < K; k++) { const s = n * K + k; if (s >= endStep) return { p, done: true }; p = phys(p, offs[s + 1], hold, obs); if (!p) return null; } return { p, done: (n + 1) * K >= endStep }; };
  const memo = new Map();
  let furthest = 0; // furthest screen frame any attempt reached (to report where an impossible level gets stuck)
  const key = (n, p) => n + ':' + p.y.toFixed(2) + ':' + p.vy.toFixed(1) + ':' + p.g;
  function win(n, p) {
    if (n > furthest) furthest = n;
    const k = key(n, p);
    if (memo.has(k)) return memo.get(k);
    memo.set(k, false);
    let res = false;
    for (const hold of [false, true]) {
      if (hold && !p.g && !willLandWithin(p, n)) continue; // holding in mid-air does nothing unless we land this frame
      const r = frame(n, p, hold);
      if (r && (r.done || win(n + 1, r.p))) { res = true; break; }
    }
    memo.set(k, res);
    return res;
  }
  function willLandWithin(p, n) { const r = frame(n, p, false); return !r || r.p.g; }
  const start = { y: GROUND_Y - CUBE, vy: 0, g: true };
  if (!win(0, start)) {
    const col = Math.max(0, Math.floor((offs[Math.min(offs.length - 1, furthest * K)] - RUNWAY) / 40));
    return { ok: false, where: `stuck near column ${col}: "${lv.map.slice(Math.max(0, col - 4), col + 6)}"` };
  }
  return { ok: true };
}

for (const lv of LEVELS.filter(l => !process.argv[3] || process.argv.slice(3).includes(l.id))) {
  const row = [lv.name.padEnd(14)];
  for (const [fps, K] of [[30, 4], [60, 2], [120, 1]]) {
    const r = analyse(lv, K);
    row.push(`${fps}fps: ${r.ok ? 'possible' : 'IMPOSSIBLE (' + r.where + ')'}`);
  }
  console.log(row.join(' | '));
}
