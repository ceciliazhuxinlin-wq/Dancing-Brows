import test from "node:test";
import assert from "node:assert/strict";
import { C, browParams, pinchRatio, handTiltDeg, realBrowHeight, spacingFromHands, parabolaPoints,
  layoutSpecs, Smoother, Hold, NoteSnapper, NOTE_FREQS } from "../js/brow.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("pinch ratio ignores distance to camera", () => {
  near(pinchRatio([10, 0], [30, 0], [0, 100], [0, 0]), pinchRatio([30, 0], [90, 0], [0, 300], [0, 0]));
});
test("hand tilt angles", () => {
  near(handTiltDeg([0, 0], [0, -1]), 0); near(handTiltDeg([0, 0], [1, 0]), 90); near(handTiltDeg([0, 0], [-1, 0]), -90);
});
test("bowl has edges higher than centre, arch lower", () => {
  const bowl = parabolaPoints(100, 100, 50, 1), arch = parabolaPoints(100, 100, 50, -0.6), m = 12;
  assert.ok(bowl[0][1] < bowl[m][1] && bowl[24][1] < bowl[m][1]);
  assert.ok(arch[0][1] > arch[m][1]);
});
test("rotating a flat brow by 90 degrees makes it vertical", () => {
  const p = parabolaPoints(100, 100, 50, 0, 90);
  for (const q of p) near(q[0], 100, 1e-9);
  near(Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])), 100, 1e-9);
});
test("pinched is a low bowl, open is a high arch", () => {
  const a = browParams(0, 0), b = browParams(5, 0);
  assert.ok(a.curve > 0 && b.curve < 0 && a.height < b.height);
});
test("tilt is clamped", () => assert.equal(browParams(0.5, 200).tiltDeg, C.MAX_TILT_DEG));
test("real brow height ignores face size", () => near(realBrowHeight(90, 100, 200), realBrowHeight(180, 200, 400)));
test("hands at head width give natural spacing; together overlap; capped", () => {
  near(spacingFromHands(C.HANDS_REF * 200, 200, 0.55), 0.55);
  assert.equal(spacingFromHands(0, 200), 0);
  near(spacingFromHands(1e6, 200, 0.5), 0.5 * C.MAX_SPACING_SCALE);
});
function specs(yaw) {
  const p = browParams(2.5, 0);
  return layoutSpecs([p, p], 300, 200, 200, 260, 0.55, yaw);
}
test("no head turn means no skew", () => { const [l, r] = specs(0); assert.equal(l.depth, 1); assert.equal(r.depth, 1); near(l.halfWidth, r.halfWidth); });
test("turned head shrinks the far brow and flips with the sign", () => {
  let [l, r] = specs(30);
  assert.ok(r.depth < 1 && l.depth > 1 && r.halfWidth < l.halfWidth);
  const mean = (s) => s.points().reduce((a, q) => a + q[1], 0) / 25;
  assert.ok(Math.abs(mean(r) - 200) < Math.abs(mean(l) - 200));
  [l, r] = specs(-30);
  assert.ok(l.depth < 1 && r.depth > 1);
});
test("smoothing is frame-rate independent", () => {
  const settle = (fps) => { const s = new Smoother(0.065); s.update(0, 1 / fps); for (let i = 0; i < Math.round(0.2 * fps); i++) s.update(1, 1 / fps); return s.value; };
  assert.ok(Math.abs(settle(15) - settle(30)) < 0.01 && Math.abs(settle(60) - settle(30)) < 0.01);
});
test("hold bridges a short dropout then gives up for good", () => {
  const h = new Hold(0.4);
  assert.equal(h.update("f", 0), "f"); assert.equal(h.update(null, 0.4), "f");
  assert.equal(h.update(null, 0.5), null); assert.equal(h.update(null, 0.6), null);
});
test("notes: pentatonic C3..C5 and no fluttering on a border", () => {
  near(NOTE_FREQS[0], 130.81, 0.01); near(NOTE_FREQS.at(-1), 523.25, 0.01); assert.equal(NOTE_FREQS.length, 11);
  const sn = new NoteSnapper(), n = NOTE_FREQS.length - 1, first = sn.freq(0.5);
  const border = (sn.idx + 0.5) / n;
  assert.equal(sn.freq(border + 0.01), first); assert.equal(sn.freq(border - 0.01), first);
});
