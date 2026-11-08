// Pure maths for the brow instrument (port of brow.py). No DOM, no MediaPipe: unit tested in Node.
// Screen coordinates: x right, y DOWN.

// Starting points chosen by feel, NOT measurements.
export const C = {
  PINCH_MIN: 0.10, PINCH_MAX: 1.0,       // thumb-index distance / hand size
  HEIGHT_MIN: 0.06, HEIGHT_MAX: 0.22,    // brow above the eye line, fraction of face height
  CURVE_BOWL: 1.0, CURVE_ARCH: -0.6,     // curve > 0 bowl (U), < 0 arch (n)
  MAX_TILT_DEG: 45,
  BROW_HALF_WIDTH: 0.17,                 // fraction of face width
  DEFAULT_SPACING: 0.55,
  HANDS_REF: 1.4,                        // hands this many face-widths apart = natural spacing
  MAX_SPACING_SCALE: 2.0,
  PERSPECTIVE_K: 0.5,
};

export const clip01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const normalise = (x, lo, hi) => clip01((x - lo) / (hi - lo));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const handSize = (wrist, middleMcp) => dist(wrist, middleMcp);

export function pinchRatio(thumbTip, indexTip, wrist, middleMcp) {
  const size = handSize(wrist, middleMcp);
  return size < 1e-6 ? 0 : dist(thumbTip, indexTip) / size;
}

/** 0 = fingers up, +90 = pointing right, -90 = pointing left. */
export function handTiltDeg(wrist, middleMcp) {
  const vx = middleMcp[0] - wrist[0], vy = middleMcp[1] - wrist[1];
  return (Math.atan2(vx, -vy) * 180) / Math.PI;
}

/** Gap between eye top and brow, divided by face height (AU1/AU2 raise it, AU4 lowers it). */
export const realBrowHeight = (browY, eyeY, faceH) => (eyeY - browY) / faceH;

/** Pinched -> low bowl. Open -> high arch. */
export function browParams(pinch, tiltDeg) {
  const t = normalise(pinch, C.PINCH_MIN, C.PINCH_MAX);
  return {
    t,
    height: lerp(C.HEIGHT_MIN, C.HEIGHT_MAX, t),
    curve: lerp(C.CURVE_BOWL, C.CURVE_ARCH, t),
    tiltDeg: Math.max(-C.MAX_TILT_DEG, Math.min(C.MAX_TILT_DEG, tiltDeg)),
  };
}

/** Brow centre-to-centre distance as a fraction of face width. */
export function spacingFromHands(handsDist, faceW, natural = C.DEFAULT_SPACING) {
  const ratio = handsDist / (C.HANDS_REF * faceW);
  return natural * Math.min(Math.max(ratio, 0), C.MAX_SPACING_SCALE);
}

/** Points of y = a (x-xc)^2 + y0, rotated clockwise about (cx, cy). a_norm = edge height / half width. */
export function parabolaPoints(cx, cy, halfWidth, aNorm, angleDeg = 0, n = 25) {
  const th = (angleDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = -halfWidth + (2 * halfWidth * i) / (n - 1);
    const y = -(aNorm / halfWidth) * x * x;           // y up -> pixel y down
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

/** One cartoon brow. depthGain describes head-turn perspective (far side = smaller). */
export class BrowSpec {
  constructor(o) { Object.assign(this, { eyeY: 0, anchorX: 0, depthGain: 0 }, o); }
  depthFactor(x) { return Math.min(1.6, Math.max(0.4, 1 - this.depthGain * (x - this.anchorX))); }
  get depth() { return this.depthFactor(this.cx); }
  points(n = 25) {
    const p = parabolaPoints(this.cx, this.cy, this.halfWidth, this.aNorm, this.angleDeg, n);
    if (this.depthGain) for (const q of p) q[1] = this.eyeY + (q[1] - this.eyeY) * this.depthFactor(q[0]);
    return p;
  }
}

/** yawDeg > 0: the screen-right side of the head is further from the camera. */
export function layoutSpecs(paramsPair, anchorX, eyeY, faceW, faceH, spacing, yawDeg = 0) {
  const gain = (C.PERSPECTIVE_K * Math.sin((yawDeg * Math.PI) / 180)) / (faceW / 2);
  return [-1, 1].map((side, i) => {
    const p = paramsPair[i];
    const cx = anchorX + (side * spacing * faceW) / 2;
    const spec = new BrowSpec({
      cx, cy: eyeY - p.height * faceH, halfWidth: C.BROW_HALF_WIDTH * faceW,
      aNorm: p.curve, angleDeg: p.tiltDeg, eyeY, anchorX, depthGain: gain,
    });
    spec.halfWidth *= spec.depth;                      // far brow is narrower too
    return spec;
  });
}

/** Exponential smoothing with a time constant, so it feels the same at any frame rate. */
export class Smoother {
  constructor(tau = 0.065) { this.tau = tau; this.value = null; }
  update(x, dt) {
    if (this.value === null) { this.value = x; return x; }
    const a = 1 - Math.exp(-dt / this.tau);
    this.value += a * (x - this.value);
    return this.value;
  }
}

/** Keep the last good value for `timeout` seconds, then give up (null). */
export class Hold {
  constructor(timeout = 0.4) { this.timeout = timeout; this.value = null; this.stamp = 0; }
  update(value, now) {
    if (value != null) { this.value = value; this.stamp = now; return value; }
    if (this.value != null && now - this.stamp <= this.timeout) return this.value;
    this.value = null;
    return null;
  }
}

/** C major pentatonic, C3..C5, with hysteresis so a note does not flutter on a border. */
export const NOTE_FREQS = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72].map((m) => 440 * 2 ** ((m - 69) / 12));
export class NoteSnapper {
  constructor(hys = 0.65) { this.hys = hys; this.idx = null; }
  freq(t) {
    const x = clip01(t) * (NOTE_FREQS.length - 1);
    if (this.idx === null || Math.abs(x - this.idx) > this.hys) this.idx = Math.round(x);
    return NOTE_FREQS[this.idx];
  }
}
