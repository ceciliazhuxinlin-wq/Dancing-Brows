import test from "node:test";
import assert from "node:assert/strict";
import { browParams } from "../js/brow.js";
import { moodScores, MoodTracker, pickCue } from "../js/expression.js";
import { TutorialProgress, STEPS } from "../js/tutorial.js";

const P = (pinch, tilt = 0) => browParams(pinch, tilt);
const top = (s) => Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];

test("both hands wide open and level look happy", () => assert.equal(top(moodScores(P(1.0), P(1.0))), "happy"));
test("both hands pinched look sad", () => assert.equal(top(moodScores(P(0.1), P(0.1))), "sad"));
test("inner ends up (worried tilt) looks sad even at medium height", () => {
  const s = moodScores(P(0.5, -30), P(0.5, 30)); assert.equal(top(s), "sad"); assert.ok(s.sad > 0.9);
});
test("one open and one pinched looks confused", () => {
  const s = moodScores(P(1.0), P(0.1)); assert.equal(top(s), "confused"); assert.ok(s.confused >= 0.9);
});
test("both brows tilted the same way looks confused", () => assert.ok(moodScores(P(0.6, 30), P(0.6, 30)).confused > 0.6));
test("a relaxed middle position is nothing in particular", () => {
  const s = moodScores(P(0.55), P(0.55)); assert.ok(s.happy < 0.6 && s.sad < 0.6 && s.confused < 0.6);
});
test("a mirrored one-hand gesture is never confused", () => {
  assert.ok(moodScores(P(0.8, -15), P(0.8, 15)).confused < 0.1);
});

test("mood needs a short dwell, then fires once on entry", () => {
  const m = new MoodTracker(); const happy = { happy: 1, sad: 0, confused: 0 };
  let r = m.update(happy, 0); assert.equal(r.mood, "neutral");
  r = m.update(happy, 100); assert.equal(r.mood, "neutral");
  r = m.update(happy, 250); assert.equal(r.mood, "happy"); assert.ok(r.entered && r.fire);
  r = m.update(happy, 400); assert.ok(!r.fire);
});
test("one noisy frame does not change the mood", () => {
  const m = new MoodTracker(); const happy = { happy: 1, sad: 0, confused: 0 };
  m.update(happy, 0); m.update(happy, 250);
  const r = m.update({ happy: 0.1, sad: 0, confused: 0 }, 300); assert.equal(r.mood, "happy");
});
test("hysteresis: stays happy between the exit and enter thresholds", () => {
  const m = new MoodTracker(); m.update({ happy: 1, sad: 0, confused: 0 }, 0); m.update({ happy: 1, sad: 0, confused: 0 }, 250);
  assert.equal(m.update({ happy: 0.5, sad: 0, confused: 0 }, 300).mood, "happy");
});
test("returns to neutral after the hands go away, and can re-trigger after the cooldown", () => {
  const m = new MoodTracker(); const sad = { happy: 0, sad: 1, confused: 0 };
  m.update(sad, 0); assert.ok(m.update(sad, 250).fire);
  m.update(null, 300); assert.equal(m.update(null, 450).mood, "neutral");
  m.update(sad, 500); assert.ok(!m.update(sad, 800).fire, "inside the cooldown");
  m.update(null, 900); m.update(null, 1100);
  m.update(sad, 2000); assert.ok(m.update(sad, 2300).fire, "after the cooldown");
});
test("holding a mood plays the effect again after a long time", () => {
  const m = new MoodTracker(); const c = { happy: 0, sad: 0, confused: 1 };
  m.update(c, 0); assert.ok(m.update(c, 250).fire);
  assert.ok(!m.update(c, 3000).fire); assert.ok(m.update(c, 5000).fire);
});
test("cue text exists for every mood", () => { for (const k of ["neutral", "happy", "sad", "confused"]) assert.ok(pickCue(k, 7).length > 3); });

test("tutorial advances by itself when you do the thing", () => {
  const t = new TutorialProgress();
  assert.equal(t.step.id, "hands");
  t.observe({ hands: 1, t: [0.5, 0.5], tiltDeg: [0, 0], mood: "neutral" }); assert.equal(t.step.id, "pinch");
  t.observe({ hands: 1, t: [0.1, 0.1], tiltDeg: [0, 0], mood: "neutral" }); assert.equal(t.step.id, "pinch");
  t.observe({ hands: 1, t: [0.9, 0.9], tiltDeg: [0, 0], mood: "neutral" }); assert.equal(t.step.id, "tilt");
  t.observe({ hands: 1, t: [0.5, 0.5], tiltDeg: [30, -30], mood: "neutral" }); assert.equal(t.step.id, "face");
  t.observe({ hands: 2, t: [0.5, 0.5], tiltDeg: [0, 0], mood: "happy" }); assert.equal(t.step.id, "face");
  t.observe({ hands: 2, t: [0.5, 0.5], tiltDeg: [0, 0], mood: "sad" }); assert.equal(t.step.id, "done");
});
test("next / back / skip always work, with or without a camera", () => {
  const t = new TutorialProgress();
  for (let i = 0; i < STEPS.length - 1; i++) t.next();
  assert.equal(t.step.id, "done"); t.back(); assert.equal(t.index, STEPS.length - 2);
  assert.ok(!t.finished); t.skip(); assert.ok(t.finished);
  const u = new TutorialProgress(); for (let i = 0; i < STEPS.length; i++) u.next(); assert.ok(u.finished);
});

test("two real hands that are open but not identical still look happy", () => {
  const s = moodScores(P(0.95, 3), P(0.85, 8));
  assert.ok(s.happy >= 0.6 && s.confused < 0.1, JSON.stringify(s));
});
test("hands about three-quarters open are enough for happy", () => {
  assert.ok(moodScores(P(0.78), P(0.78)).happy >= 0.6);
});
test("hands mostly pinched are enough for sad", () => {
  assert.ok(moodScores(P(0.3), P(0.3)).sad >= 0.6);
});
test("a clearly mismatched pair is still confused", () => {
  assert.ok(moodScores(P(0.9), P(0.4)).confused >= 0.6);
});
