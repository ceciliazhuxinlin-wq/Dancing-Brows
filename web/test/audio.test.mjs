import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS } from "../js/audio.js";
import { MOODS } from "../js/expression.js";

// A recording stand-in for the Web Audio API, so the effects can be checked without a browser.
function fakeCtx() {
  const oscs = [], param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect(to) { return to; }, ...extra });
  return {
    oscs,
    createOscillator() { const o = node({ type: "sine", frequency: param(), start(t) { o.t0 = t; }, stop(t) { o.t1 = t; } }); oscs.push(o); return o; },
    createGain() { return node({ gain: param() }); },
    createBiquadFilter() { return node({ type: "lowpass", frequency: param(), Q: { value: 1 } }); },
  };
}

test("every mood except neutral has a sound effect", () => {
  for (const m of MOODS.filter((x) => x !== "neutral")) assert.equal(typeof EFFECTS[m], "function", m);
});
test("each effect schedules sound inside the length it reports, and starts what it stops", () => {
  for (const [name, fx] of Object.entries(EFFECTS)) {
    const ctx = fakeCtx(), out = { connect() {} }, t0 = 5, len = fx(ctx, out, t0);
    assert.ok(len > 0.3 && len < 4, `${name} length ${len}`);
    assert.ok(ctx.oscs.length >= 2, `${name} makes some sound`);
    for (const o of ctx.oscs) {
      assert.ok(o.t0 >= t0 && o.t1 > o.t0, `${name} oscillator timing`);
      assert.ok(o.t1 <= t0 + len + 1e-9, `${name} ends by ${t0 + len}, got ${o.t1}`);
    }
  }
});
