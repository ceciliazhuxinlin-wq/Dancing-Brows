// Tutorial steps + progress. The tutorial can complete steps by itself when you do the thing,
// but Next / Back / Skip always work. Pure logic, unit tested.
export const STEPS = [
  { id: "hands", emoji: "✋", title: "Show me your hands", text: "Hold up one or both hands so the camera can see them. One hand controls both brows." },
  { id: "pinch", emoji: "🤏", title: "Pinch and open", text: "Close your thumb and finger for a low, U-shaped brow. Open them for a high arch." },
  { id: "tilt", emoji: "📐", title: "Tilt and spread", text: "Tilt a hand to rotate its brow. Move two hands apart or together to space the brows." },
  { id: "face", emoji: "😄", title: "Make a face", text: "Two open hands look happy. Two pinched hands look sad. One of each looks confused." },
  { id: "done", emoji: "📖", title: "You're set", text: "Press H any time for the handbook. Press ? to replay this tutorial." },
];

/** frame: { hands: number, t: [pinch t per brow], tiltDeg: [..], mood: string } */
export class TutorialProgress {
  constructor() { this.index = 0; this.done = new Set(); this.pinchLow = false; this.pinchHigh = false; this.moods = new Set(); this.finished = false; }
  get step() { return STEPS[this.index]; }
  observe(f) {
    if (f.hands > 0) this.done.add("hands");
    for (const t of f.t || []) { if (t < 0.25) this.pinchLow = true; if (t > 0.75) this.pinchHigh = true; }
    if (this.pinchLow && this.pinchHigh) this.done.add("pinch");
    if (f.hands > 1 || (f.tiltDeg || []).some((d) => Math.abs(d) > 20)) this.done.add("tilt");
    if (f.mood && f.mood !== "neutral") { this.moods.add(f.mood); if (this.moods.size >= 2) this.done.add("face"); }
    // auto-advance when the current step is completed
    while (!this.finished && this.index < STEPS.length - 1 && this.done.has(STEPS[this.index].id)) this.index++;
    return this.index;
  }
  next() { if (this.index < STEPS.length - 1) this.index++; else this.finished = true; return this.index; }
  back() { if (this.index > 0) this.index--; return this.index; }
  skip() { this.finished = true; }
}
