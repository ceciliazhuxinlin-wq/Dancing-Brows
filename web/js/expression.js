// Turns the two cartoon brows into a mood: happy / sad / angry / confused / neutral.
// Pure functions + a small state machine, unit tested in Node. Thresholds are chosen by feel, not measured.
import { clip01 } from "./brow.js";

export const MOODS = ["neutral", "happy", "sad", "angry", "confused"];

/**
 * left/right: { t, curve, tiltDeg } from browParams().
 *  curve < 0 = arch (n), curve > 0 = bowl (U).  tiltDeg > 0 = rotated clockwise on screen.
 *  "Inner ends up" (worried / sad, "/ \") = left brow tilted counter-clockwise, right brow clockwise.
 *  "Inner ends down" (angry, "\ /") is the opposite: left clockwise, right counter-clockwise.
 * Returns scores 0..1.
 */
export function moodScores(left, right) {
  const curve = (left.curve + right.curve) / 2;
  const innerUp = (-left.tiltDeg + right.tiltDeg) / 2;             // degrees
  const rawAsym = Math.max(
    Math.abs(left.t - right.t) / 0.5,                              // one open, one pinched
    Math.abs(left.tiltDeg + right.tiltDeg) / 50,                   // both rotated the same way
    Math.abs(left.curve - right.curve) / 0.8,
  );
  const asym = clip01((rawAsym - 0.35) / 0.65);                    // dead zone: two real hands are never perfectly matched
  const arch = clip01((0.1 - curve) / 0.45);                       // natural, curvy arch (hands about 3/4 open or more)
  const bowl = clip01((curve - 0.25) / 0.45);                      // low U shape (fingers mostly pinched)
  const droop = clip01(innerUp / 25);                              // sad "worried" tilt, inner ends up
  const glare = clip01((-innerUp - 3) / 20);                       // angry tilt, inner ends down (same size as droop, opposite sign)
  return {
    happy: arch * (1 - asym) * (1 - glare),                        // a clear glare beats a pretty arch or a pinch
    sad: Math.max(bowl, droop) * (1 - asym) * (1 - glare),
    angry: glare * (1 - asym),
    confused: asym,
  };
}

/**
 * Hysteresis + dwell so a mood is not flipped by one noisy frame, and effects fire
 * once on entry (and again only after a long hold).
 */
export class MoodTracker {
  constructor({ enter = 0.6, exit = 0.4, dwellMs = 220, neutralDwellMs = 120, cooldownMs = 1500, repeatMs = 4500 } = {}) {
    Object.assign(this, { enter, exit, dwellMs, neutralDwellMs, cooldownMs, repeatMs });
    this.mood = "neutral"; this.since = 0; this.pending = null; this.lastFire = {};
  }
  _candidate(s) {
    if (s.confused >= this.enter) return "confused";
    const best = ["happy", "sad", "angry"].reduce((a, k) => (s[k] > s[a] ? k : a), "happy");   // ties keep the earlier mood
    return s[best] >= this.enter ? best : null;
  }
  /** scores may be null (no brows). Returns { mood, entered, fire, strength }. */
  update(scores, nowMs) {
    const s = { happy: 0, sad: 0, angry: 0, confused: 0, ...scores };       // missing keys count as 0
    const cand = this._candidate(s);
    let target;
    if (this.mood !== "neutral" && s[this.mood] >= this.exit && (!cand || cand === this.mood || s[cand] < s[this.mood] + 0.15)) target = this.mood;
    else target = cand || "neutral";

    let entered = false;
    if (target === this.mood) this.pending = null;
    else if (this.pending && this.pending.mood === target) {
      const need = target === "neutral" ? this.neutralDwellMs : this.dwellMs;
      if (nowMs - this.pending.since >= need) { this.mood = target; this.since = nowMs; this.pending = null; entered = true; }
    } else this.pending = { mood: target, since: nowMs };

    let fire = false;
    if (this.mood !== "neutral") {
      const last = this.lastFire[this.mood] ?? -Infinity;
      if (entered && nowMs - last >= this.cooldownMs) fire = true;
      else if (!entered && nowMs - last >= this.repeatMs) fire = true;     // still holding: play again
      if (fire) this.lastFire[this.mood] = nowMs;
    }
    return { mood: this.mood, entered, fire, strength: this.mood === "neutral" ? 0 : s[this.mood] };
  }
}

/** Playful cue text shown at the top of the stage. */
export const CUES = {
  neutral: ["Make a face ✨", "Pinch and open your fingers to move your brows"],
  happy: ["Are we happy now? 😄", "Ooh, someone's in a good mood!", "Is that a giggle? 🥰"],
  sad: ["Are we sad now? 🥺", "Aww, what happened? 😢", "Do we need a tissue? 💧"],
  angry: ["Uh oh… are we angry now? 😠", "Grr! Someone is grumpy 😤", "Those brows mean business 💢"],
  confused: ["Wait… are we confused? 🤨", "Goofy brows detected 🥴", "One brow says yes, one says no ❓"],
};
export const EMOJI = {
  happy: ["😄", "😆", "🥰", "✨"],
  sad: ["😢", "🥺", "💧", "😭"],
  angry: ["😠", "💢", "😤", "🔥"],
  confused: ["🤨", "🥴", "❓", "😵‍💫"],
};
export function pickCue(mood, n = 0) { const a = CUES[mood]; return a[n % a.length]; }
