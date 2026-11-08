// Homepage preview: the same maths and mood logic as the app, driven by the demo script. No camera.
import { C, browParams, layoutSpecs, spacingFromHands } from "./brow.js";
import { demoScript } from "./demo.js";
import { moodScores, MoodTracker, pickCue } from "./expression.js";

const FACE = { w: 170, h: 210, ax: 200, eyeY: 142 };
const EMO = { neutral: "🙂", happy: "😄", sad: "🥺", confused: "🤨" };
const f = (n) => n.toFixed(1);

export function startHero(svg, cueEl) {
  svg.innerHTML = `
    <ellipse cx="200" cy="165" rx="92" ry="128" fill="#e9c3a4"/>
    <ellipse cx="156" cy="${FACE.eyeY}" rx="8" ry="7" fill="#2b2b2f"/><ellipse cx="244" cy="${FACE.eyeY}" rx="8" ry="7" fill="#2b2b2f"/>
    <ellipse cx="146" cy="192" rx="13" ry="8" fill="rgba(240,140,140,.4)"/><ellipse cx="254" cy="192" rx="13" ry="8" fill="rgba(240,140,140,.4)"/>
    <path id="h-mouth" d="M170 218 Q200 232 230 218" fill="none" stroke="#a9715a" stroke-width="4" stroke-linecap="round"/>
    <path id="h-b0" fill="none" stroke="#343436" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <path id="h-b1" fill="none" stroke="#343436" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    <text id="h-emo" x="340" y="52" font-size="40" text-anchor="middle">🙂</text>`;
  const b = [svg.querySelector("#h-b0"), svg.querySelector("#h-b1")], mouth = svg.querySelector("#h-mouth"), emo = svg.querySelector("#h-emo");
  const tracker = new MoodTracker({ dwellMs: 150 });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0, visible = true, cueN = 0, last = "";

  function draw(tSec) {
    const s = demoScript(tSec);
    const params = [browParams(s.pinch[0], s.tilt[0]), browParams(s.pinch[1], s.tilt[1])];
    const spacing = spacingFromHands(s.dist * FACE.w, FACE.w, C.DEFAULT_SPACING);
    const specs = layoutSpecs(params, FACE.ax, FACE.eyeY, FACE.w, FACE.h, spacing, s.yaw);
    specs.forEach((sp, i) => b[i].setAttribute("d", "M" + sp.points().map((p) => `${f(p[0])} ${f(p[1])}`).join(" L")));
    const m = tracker.update(moodScores(params[0], params[1]), tSec * 1000);
    const bend = m.mood === "happy" ? 16 : m.mood === "sad" ? -10 : m.mood === "confused" ? 2 : 8;
    mouth.setAttribute("d", `M170 220 Q200 ${220 + bend} 230 ${m.mood === "confused" ? 214 : 220}`);
    emo.textContent = EMO[m.mood];
    if (m.mood !== last) { if (m.mood !== "neutral") cueN++; cueEl.textContent = pickCue(m.mood, cueN); last = m.mood; }
  }
  function tick(now) { if (visible && !document.hidden) draw(now / 1000); raf = requestAnimationFrame(tick); }
  if (still) { draw(1.5); draw(1.9); }                                  // reduced motion: one static happy frame
  else raf = requestAnimationFrame(tick);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(svg);
  return () => { cancelAnimationFrame(raf); io.disconnect(); };
}
