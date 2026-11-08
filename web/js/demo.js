// A scripted "hands" performance so the page works without a camera (and for screenshots/tests).
// 16 s loop: happy -> sad -> confused -> free play. Values are what real hands would produce.
const smooth = (x) => x * x * (3 - 2 * x);
const KEYS = [
  { t: 0,  pinch: [1.0, 1.0],  tilt: [0, 0],     dist: 1.4 },    // happy: both open, level
  { t: 4,  pinch: [0.1, 0.1],  tilt: [-22, 22],  dist: 1.4 },    // sad: pinched, inner ends up
  { t: 8,  pinch: [1.0, 0.1],  tilt: [0, 0],     dist: 1.4 },    // confused: one open, one pinched
  { t: 12, pinch: [0.55, 0.55], tilt: [0, 0],    dist: 1.4 },    // free play starts relaxed
];
export const LOOP_S = 16;

export function demoScript(tSec) {
  const t = tSec % LOOP_S;
  let i = KEYS.length - 1;
  while (i > 0 && t < KEYS[i].t) i--;
  const cur = KEYS[i], prev = KEYS[(i + KEYS.length - 1) % KEYS.length];
  const k = smooth(Math.min(1, (t - cur.t) / 0.8));
  const mix = (a, b) => a + (b - a) * k;
  let pinch = [mix(prev.pinch[0], cur.pinch[0]), mix(prev.pinch[1], cur.pinch[1])];
  let tilt = [mix(prev.tilt[0], cur.tilt[0]), mix(prev.tilt[1], cur.tilt[1])];
  let dist = mix(prev.dist, cur.dist);
  if (cur.t === 12) {                                   // free play: wander a bit
    const u = t - 12;
    pinch = [0.55 + 0.4 * Math.sin(u * 1.7), 0.55 + 0.4 * Math.sin(u * 1.7 + 1.2)];
    tilt = [18 * Math.sin(u * 1.3), 18 * Math.sin(u * 1.1 + 2)];
    dist = 1.4 + 0.6 * Math.sin(u * 0.9);
  }
  return { pinch, tilt, dist, yaw: 16 * Math.sin(tSec * 0.45) };
}
