// Sound: three little effects (giggle / sad / confused) and an optional soft note voice.
// Effect functions take (ctx, out, t0) so they work with a live AudioContext AND an
// OfflineAudioContext (that is how they are tested). Each returns its length in seconds.

function blip(ctx, out, { t, type = "sine", f0, f1, dur, peak = 0.3, attack = 0.01, filter }) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc;
  if (filter) {
    const bp = ctx.createBiquadFilter();
    bp.type = filter.type; bp.frequency.value = filter.freq; bp.Q.value = filter.q ?? 1;
    node.connect(bp); node = bp;
  }
  node.connect(g).connect(out);
  osc.start(t); osc.stop(t + dur + 0.02);
}

/** "hee hee hee": short rising chirps, a little uneven like a real giggle. */
export function giggle(ctx, out, t0 = 0) {
  const pitches = [640, 710, 680, 770, 730];
  pitches.forEach((f, i) => blip(ctx, out, {
    t: t0 + i * 0.115 + (i % 2 ? 0.012 : 0), type: "triangle", f0: f, f1: f * 1.18, dur: 0.09, peak: 0.65,
    filter: { type: "bandpass", freq: 1400, q: 1.1 },
  }));
  return 0.7;
}

/** Gentle "womp womp womp wooomp" then two drips. */
export function sad(ctx, out, t0 = 0) {
  const notes = [[392, 0, 0.28], [370, 0.32, 0.28], [349, 0.64, 0.28], [311, 0.98, 0.75]];
  notes.forEach(([f, at, dur], i) => {
    const t = t0 + at, osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.96, t + dur);
    lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(420, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.setValueAtTime(0.16, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (i === notes.length - 1) {                        // wobble on the last note
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5; depth.gain.value = 7; lfo.connect(depth).connect(osc.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.02);
    }
    osc.connect(lp).connect(g).connect(out); osc.start(t); osc.stop(t + dur + 0.02);
  });
  [1.85, 2.2].forEach((at, i) => blip(ctx, out, { t: t0 + at, f0: 1500 - i * 150, f1: 720, dur: 0.14, peak: 0.22, attack: 0.004 }));
  return 2.45;
}

/** Two cartoon "boings" with a wobble. */
export function confused(ctx, out, t0 = 0) {
  const t = t0, osc = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.linearRampToValueAtTime(780, t + 0.2);
  osc.frequency.linearRampToValueAtTime(250, t + 0.6);
  lfo.frequency.value = 9; depth.gain.value = 35; lfo.connect(depth).connect(osc.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  osc.connect(g).connect(out); osc.start(t); lfo.start(t); osc.stop(t + 0.68); lfo.stop(t + 0.68);
  blip(ctx, out, { t: t0 + 0.72, type: "triangle", f0: 480, f1: 900, dur: 0.16, peak: 0.28 });
  return 0.95;
}

export const EFFECTS = { happy: giggle, sad, confused };

export class AudioEngine {
  constructor() { this.ctx = null; this.muted = false; this.effects = true; this.notes = false; this.voice = null; this.lastNote = null; }
  /** Must be called from a user gesture (browser autoplay rules). */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();           // keeps stacked sounds from clipping
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }
  get live() { return this.ctx && this.ctx.state === "running" && !this.muted; }
  playMood(mood) {
    if (!this.live || !this.effects || !EFFECTS[mood]) return 0;
    return EFFECTS[mood](this.ctx, this.master, this.ctx.currentTime + 0.02);
  }
  /** freq in Hz, or null for silence. A soft bell-like voice with a small pluck on each new note. */
  setNote(freq) {
    if (!this.ctx) return;
    if (!this.voice) {
      const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g2 = this.ctx.createGain(), g = this.ctx.createGain();
      o1.type = o2.type = "sine"; g2.gain.value = 0.25; g.gain.value = 0;
      o1.connect(g); o2.connect(g2).connect(g); g.connect(this.master); o1.start(); o2.start();
      this.voice = { o1, o2, g };
    }
    const { o1, o2, g } = this.voice, t = this.ctx.currentTime;
    if (freq == null || !this.live || !this.notes) {
      g.gain.setTargetAtTime(0, t, 0.05); this.lastNote = null; return;
    }
    if (freq !== this.lastNote) {
      o1.frequency.setTargetAtTime(freq, t, 0.01); o2.frequency.setTargetAtTime(freq * 2, t, 0.01);
      g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.16, t, 0.004); g.gain.setTargetAtTime(0.06, t + 0.04, 0.2);
      this.lastNote = freq;
    }
  }
}
