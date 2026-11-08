// Dancing Brows (web): glue between camera, tracking, brows, moods, sound and UI.
import { C, Hold, NoteSnapper, Smoother, browParams, layoutSpecs, normalise, spacingFromHands, dist } from "./brow.js";
import { AudioEngine } from "./audio.js";
import { EMOJI, MoodTracker, moodScores, pickCue } from "./expression.js";
import { renderHandbook } from "./handbook.js";
import { startHero } from "./hero.js";
import { STYLES, captureBrowSprites, drawBrow, drawDemoFace, drawHandDebug, drawSprite, drawVideoMirrored, hideBrows } from "./render.js";
import { createDemoTracker, createTracker } from "./tracking.js";
import { STEPS, TutorialProgress } from "./tutorial.js";

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("db." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("db." + k, JSON.stringify(v)); } catch { /* storage blocked: fine */ } },
};

const TAU = { hand: 0.065, dist: 0.093, natural: 0.65, fps: 0.32 };
const HOLD = { face: 0.4, hand: 0.3 };

const S = {
  running: false, mode: null, raf: 0, tracker: null, stream: null, audio: new AudioEngine(),
  style: store.get("style", "classic"), sprites: null, hide: false, debug: false,
  wantCapture: null, cueN: 0, tutorial: null, lastTutorialRender: -1,
};
S.audio.effects = store.get("effects", true); S.audio.notes = store.get("notes", false);

const cv = $("#cv"), ctx = cv.getContext("2d", { willReadFrequently: true }), video = $("#video");

/* ---------------- UI helpers ---------------- */
let toastTimer = 0;
function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

function styleIcon(id) {
  const w = { thin: 1.6, bold: 4.4, fuzzy: 2.4 }[id] ?? 3, col = id === "own" ? "#ffb38a" : ({ tapered: "#9b7860", thin: "#b6a89c", soft: "#b6a89c", fuzzy: "#9b7860" }[id] || "#cfcac2");
  return `<svg viewBox="0 0 26 12" aria-hidden="true"><path d="M2 9 Q13 -3 24 9" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
}
function buildStyleChips() {
  const box = $("#style-chips"); box.innerHTML = "";
  for (const st of STYLES) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "style"; b.dataset.style = st.id; b.innerHTML = `${styleIcon(st.id)}${st.label}`;
    b.addEventListener("click", () => setStyle(st.id));
    box.append(b);
  }
  refreshStyleChips();
}
function refreshStyleChips() { document.querySelectorAll(".style").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.style === S.style))); }
function setStyle(id) {
  if (id === "own" && !S.sprites) { toast(S.mode === "demo" ? "“My brows” needs a camera." : "Press Capture my brows first."); return; }
  S.style = id; store.set("style", id); refreshStyleChips();
}
function setPressed(id, v) { $(id).setAttribute("aria-pressed", String(v)); }

function showHandbook(open) { const d = $("#drawer"); d.classList.toggle("open", open); d.setAttribute("aria-hidden", String(!open)); if (open) $("#drawer-close").focus(); }

/* ---------------- Tutorial strip ---------------- */
function renderCoach() {
  const t = S.tutorial; if (!t) return;
  const step = t.step;
  const key = t.index + ":" + [...t.done].join();
  if (S.lastTutorialRender === key) return;
  S.lastTutorialRender = key;
  $("#coach-emoji").textContent = step.emoji; $("#coach-title").textContent = step.title; $("#coach-body").textContent = step.text;
  $("#coach-dots").innerHTML = STEPS.map((s, i) => `<i class="${i === t.index ? "on" : t.done.has(s.id) ? "ok" : ""}"></i>`).join("");
  $("#coach-back").disabled = t.index === 0; $("#coach-next").textContent = t.index === STEPS.length - 1 ? "Got it" : "Next";
}
function openTutorial() { S.tutorial = new TutorialProgress(); S.lastTutorialRender = -1; $("#coach").hidden = false; renderCoach(); }
function closeTutorial() {                        // skipping or finishing both mean "don't auto-show again"
  if (S.tutorial) S.tutorial.skip();
  store.set("tutorialDone", true);
  $("#coach").hidden = true;
}
$("#coach-next").addEventListener("click", () => { const t = S.tutorial; if (t.index === STEPS.length - 1) closeTutorial(); else { t.next(); renderCoach(); } });
$("#coach-back").addEventListener("click", () => { S.tutorial.back(); renderCoach(); });
$("#coach-skip").addEventListener("click", closeTutorial);

/* ---------------- Effects: cue, badge, emoji ---------------- */
let lastMood = "neutral";
function setCue(text, mood) {
  const c = $("#cue"); if (c.textContent === text && c.dataset.mood === mood) return;
  c.textContent = text; c.dataset.mood = mood; c.className = `cue m-${mood} swap`;
  setTimeout(() => c.classList.remove("swap"), 400);
}
const rnd = (a, b) => a + Math.random() * (b - a);
function burst(mood, face) {
  const layer = $("#emoji-layer"), W = cv.width, H = cv.height, set = EMOJI[mood];
  const n = reduceMotion ? 2 : 9;
  for (let i = 0; i < n; i++) {
    const el = document.createElement("span"); el.className = "emo"; el.textContent = set[i % set.length];
    const size = rnd(26, 56);
    const x = face.anchorX + (mood === "sad" ? (i % 2 ? 1 : -1) * face.faceW * 0.26 : rnd(-0.35, 0.35) * face.faceW);
    const y = mood === "sad" ? face.eyeY + face.faceH * 0.04 : face.eyeY - face.faceH * 0.3;
    el.style.cssText = `left:${(x / W) * 100}%;top:${(y / H) * 100}%;font-size:${size}px`;
    layer.append(el);
    const dx = rnd(-90, 90), rot = rnd(-30, 30), delay = i * 70, dur = rnd(1300, 1800);
    const base = "translate(-50%,-50%)";
    const frames = mood === "sad"
      ? [{ transform: `${base} scale(.3)`, opacity: 0 }, { transform: `${base} translateY(10px) scale(1)`, opacity: 1, offset: 0.15 }, { transform: `${base} translate(${dx / 4}px, ${rnd(140, 230)}px) scale(.9)`, opacity: 0 }]
      : mood === "confused"
        ? [{ transform: `${base} scale(.3) rotate(0)`, opacity: 0 }, { transform: `${base} translate(${dx / 3}px,-50px) scale(1.15) rotate(${rot}deg)`, opacity: 1, offset: 0.3 }, { transform: `${base} translate(${dx / 2}px,-70px) scale(1) rotate(${-rot}deg)`, opacity: 1, offset: 0.65 }, { transform: `${base} translate(${dx}px,-120px) scale(.9) rotate(${rot}deg)`, opacity: 0 }]
        : [{ transform: `${base} scale(.3)`, opacity: 0 }, { transform: `${base} translate(${dx / 3}px,-70px) scale(1.25) rotate(${rot}deg)`, opacity: 1, offset: 0.28 }, { transform: `${base} translate(${dx / 2}px,-30px) scale(1) rotate(${-rot}deg)`, opacity: 1, offset: 0.5 }, { transform: `${base} translate(${dx}px,-150px) scale(1) rotate(${rot}deg)`, opacity: 0 }];
    const a = el.animate(frames, { duration: reduceMotion ? 600 : dur, delay: reduceMotion ? 0 : delay, easing: "cubic-bezier(.25,.8,.35,1)", fill: "both" });
    a.onfinish = () => el.remove();
  }
  const badge = $("#badge"); badge.textContent = { happy: "😄", sad: "🥺", confused: "🤨" }[mood]; badge.classList.remove("pop"); void badge.offsetWidth; badge.classList.add("pop");
}

/* ---------------- Main loop ---------------- */
function startLoop() {
  const sm = {
    pinch: [new Smoother(TAU.hand), new Smoother(TAU.hand)], tilt: [new Smoother(TAU.hand), new Smoother(TAU.hand)],
    dist: new Smoother(TAU.dist), natural: new Smoother(TAU.natural), yaw: new Smoother(TAU.dist), fps: new Smoother(TAU.fps),
  };
  const faceHold = new Hold(HOLD.face), handHold = [new Hold(HOLD.hand), new Hold(HOLD.hand)];
  const moods = new MoodTracker(), snapper = new NoteSnapper();
  let last = performance.now(), lastVideoTime = -1, dbgAt = 0;
  lastMood = "neutral";

  function frame(nowMs) {
    S.raf = requestAnimationFrame(frame);
    const W = cv.width, H = cv.height, tSec = nowMs / 1000;
    const dt = Math.min(Math.max((nowMs - last) / 1000, 1 / 240), 0.25); last = nowMs;
    const fps = sm.fps.update(1 / dt, dt);

    // 1) base image
    const demo = S.mode === "demo";
    if (!demo) { if (video.readyState < 2) return; drawVideoMirrored(ctx, video, W, H); }
    // 2) tracking (skip duplicate camera frames)
    let res;
    if (demo || video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; res = S.tracker.process(video, W, H, nowMs); S.lastRes = res; }
    else res = S.lastRes || { face: null, hands: [] };
    const face = faceHold.update(res.face, tSec);
    if (demo && face) drawDemoFace(ctx, face, W, H, lastMood);

    // 3) capture / hide use a FRESH detection only (a held face may be a little stale)
    if (S.wantCapture) {
      if (res.face && !demo) { S.sprites = captureBrowSprites(ctx, res.face); S.wantCapture = null; S.hide = true; setPressed("#t-hide", true); setStyle("own"); toast("Captured! Your own brows are now the puppets."); }
      else if (nowMs > S.wantCapture) { S.wantCapture = null; toast("I couldn't see your face. Try again."); }
    }
    if (S.hide && res.face && !demo) hideBrows(ctx, res.face);

    // 4) hands -> brow parameters, remembered per slot for a moment so one dropped frame does not flicker
    const seen = new Map(res.hands.map((h) => [h.slot, h]));
    const held = [0, 1].map((slot) => {
      const h = seen.get(slot);
      const item = h ? { p: browParams(sm.pinch[slot].update(h.pinch, dt), sm.tilt[slot].update(h.tiltDeg, dt)), center: h.center } : null;
      return handHold[slot].update(item, tSec);
    });
    const active = held.filter(Boolean);

    // 5) cartoon brows (only with a known face: never drawn at a guessed position)
    let params = null, tBrow = null, yaw = 0, natural = C.DEFAULT_SPACING;
    if (face) {
      natural = sm.natural.update((face.brows[1].cx - face.brows[0].cx) / face.faceW, dt);
      yaw = sm.yaw.update(face.yawDeg, dt);
    }
    if (face && active.length) {
      params = active.map((a) => a.p);
      let spacing = natural;
      if (params.length === 1) params.push({ ...params[0], tiltDeg: -params[0].tiltDeg });      // one hand drives both (mirrored)
      else spacing = spacingFromHands(sm.dist.update(dist(active[0].center, active[1].center), dt), face.faceW, natural);
      const specs = layoutSpecs(params, face.anchorX, face.eyeY, face.faceW, face.faceH, spacing, yaw);
      const thick = Math.max(3, face.faceH * 0.035), style = S.style === "own" && !S.sprites ? "classic" : S.style;
      specs.forEach((sp, i) => (style === "own" ? drawSprite(ctx, S.sprites[i], sp) : drawBrow(ctx, sp.points(), style, Math.max(2, thick * sp.depth), i === 0)));
      tBrow = (params[0].t + params[1].t) / 2;
    }
    if (S.debug) for (const h of res.hands) drawHandDebug(ctx, h);

    // 6) mood -> cue, emoji, sound
    const ms = moods.update(params ? moodScores(params[0], params[1]) : null, nowMs);
    if (ms.mood !== lastMood) { if (ms.mood !== "neutral") S.cueN++; lastMood = ms.mood; }
    if (ms.fire && face) { S.audio.playMood(ms.mood); if (!reduceMotion || ms.entered) burst(ms.mood, face); }
    if (!face) setCue("I can't see your face 👀", "neutral");
    else if (!active.length) setCue("Show me your hands ✋", "neutral");
    else setCue(pickCue(ms.mood, ms.mood === "neutral" ? 1 : S.cueN), ms.mood);
    if (ms.mood === "neutral") $("#badge").textContent = "";
    S.audio.setNote(tBrow !== null ? snapper.freq(tBrow) : null);

    // 7) chips, tutorial, debug
    $("#chips").innerHTML = `<span class="chip ${face ? "ok" : "warn"}">${face ? "face ✓" : "face lost"}</span><span class="chip ${active.length ? "ok" : "warn"}">hands ${active.length}</span>${demo ? '<span class="chip">demo: simulated hands &amp; face</span>' : ""}`;
    if (S.tutorial && !S.tutorial.finished) { S.tutorial.observe({ hands: active.length, t: params ? params.map((p) => p.t) : [], tiltDeg: params ? params.map((p) => p.tiltDeg) : [], mood: ms.mood }); renderCoach(); }
    if (S.debug && nowMs - dbgAt > 120) {
      dbgAt = nowMs;
      const sc = params ? moodScores(params[0], params[1]) : null, au = face?.au;
      $("#debug").textContent = [
        `fps ${fps.toFixed(0)}   ${S.mode}`, `mood ${ms.mood}`,
        sc ? `happy ${sc.happy.toFixed(2)} sad ${sc.sad.toFixed(2)} conf ${sc.confused.toFixed(2)}` : "scores –",
        `head turn ${yaw.toFixed(0)}°`, face ? `real brow height ${((face.brows[0].height + face.brows[1].height) / 2).toFixed(3)}` : "no face",
        au ? `AU1 browInnerUp ${au.browInnerUp?.toFixed(2)}  AU2 outerUp ${(((au.browOuterUpLeft ?? 0) + (au.browOuterUpRight ?? 0)) / 2).toFixed(2)}  AU4 down ${(((au.browDownLeft ?? 0) + (au.browDownRight ?? 0)) / 2).toFixed(2)}` : "AU blendshapes: camera mode only",
      ].join("\n");
    }
  }
  S.raf = requestAnimationFrame(frame);
}

/* ---------------- Start / stop ---------------- */
function sizeStage(w, h) { cv.width = w; cv.height = h; $("#stage").style.setProperty("--ar", String(w / h)); }
function showStage(show) { $("#home").hidden = show; $("#stage-wrap").hidden = !show; window.scrollTo({ top: 0 }); }
function showError(title, body) { $("#loading").hidden = true; $("#error-title").textContent = title; $("#error-body").textContent = body; $("#errorbox").hidden = false; }

async function start(mode) {
  if (S.running) stop();
  S.mode = mode; S.running = true; S.sprites = null; if (S.style === "own") S.style = "classic"; refreshStyleChips();
  showStage(true); $("#loading").hidden = false; $("#errorbox").hidden = true; $("#loading-text").textContent = "loading instrument…";
  S.audio.unlock().catch(() => {});                                      // allowed here: we are inside a click
  try {
    if (mode === "demo") {
      if (innerWidth < 820) sizeStage(540, 720); else sizeStage(960, 540);   // portrait stage on phones
      S.tracker = createDemoTracker();
    } else {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no mediaDevices"), { name: "NoCamera" });
      $("#loading-text").textContent = "asking for your camera…";
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
      video.srcObject = S.stream; await video.play();
      sizeStage(video.videoWidth || 1280, video.videoHeight || 720);
      S.tracker = await createTracker({ onStatus: (m) => ($("#loading-text").textContent = m) });
    }
  } catch (err) {
    console.error(err); stop(true);
    const n = err?.name;
    if (n === "NotAllowedError" || n === "SecurityError") return showErrorAfterStop("Camera is blocked", "Allow camera access for this page (click the camera icon in the address bar), then press Start camera again. Nothing is uploaded.");
    if (n === "NotFoundError" || n === "NoCamera" || n === "OverconstrainedError") return showErrorAfterStop("No camera found", "I couldn't find a camera. You can still try the demo, which uses simulated hands and face.");
    if (n === "NotReadableError") return showErrorAfterStop("Camera is busy", "Another app may be using your camera. Close it and try again.");
    return showErrorAfterStop("Couldn't load the tracking models", "The page needs to download MediaPipe from public CDNs (jsdelivr and Google). Check your connection, or try the demo.");
  }
  $("#loading").hidden = true; startLoop();
  if (!store.get("tutorialDone", false) && !S.tutorial) openTutorial();
}
function showErrorAfterStop(t, b) { showStage(true); showError(t, b); }

function stop(keepStage = false) {
  cancelAnimationFrame(S.raf); S.running = false;
  S.tracker?.close(); S.tracker = null;
  S.stream?.getTracks().forEach((t) => t.stop()); S.stream = null; video.srcObject = null;
  S.audio.setNote(null); S.wantCapture = null; $("#emoji-layer").innerHTML = ""; $("#badge").textContent = "";
  if (!keepStage) showStage(false);
}

/* ---------------- Wiring ---------------- */
$("#start-live").addEventListener("click", () => start("live"));
$("#start-demo").addEventListener("click", () => start("demo"));
$("#error-demo").addEventListener("click", () => start("demo"));
$("#error-back").addEventListener("click", () => { $("#errorbox").hidden = true; stop(); });
$("#btn-stop").addEventListener("click", () => stop());
$("#nav-how").addEventListener("click", openTutorial);
$("#nav-handbook").addEventListener("click", () => { if (S.running) showHandbook(true); else $("#handbook").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); });
$("#btn-handbook").addEventListener("click", () => showHandbook(true));
$("#drawer-close").addEventListener("click", () => showHandbook(false));

function toggle(id, key, get, set) {
  const b = $(id); setPressed(id, get());
  b.addEventListener("click", () => { set(!get()); setPressed(id, get()); if (key) store.set(key, get()); });
}
toggle("#t-effects", "effects", () => S.audio.effects, (v) => (S.audio.effects = v));
toggle("#t-notes", "notes", () => S.audio.notes, (v) => (S.audio.notes = v));
toggle("#t-hide", null, () => S.hide, (v) => { if (v && S.mode === "demo") { toast("Hiding your brows needs a camera."); return; } S.hide = v; });
toggle("#t-debug", null, () => S.debug, (v) => { S.debug = v; $("#debug").hidden = !v; });
function setMuted(v) { S.audio.muted = v; setPressed("#btn-mute", v); $("#btn-mute").textContent = v ? "Unmute" : "Mute"; if (v) S.audio.setNote(null); }
$("#btn-mute").addEventListener("click", () => setMuted(!S.audio.muted));
$("#btn-capture").addEventListener("click", () => {
  if (S.mode !== "live" || !S.running) { toast("Capturing needs the live camera."); return; }
  const box = $("#countdown"), n = $("#countdown-n"); let c = 3; box.hidden = false; n.textContent = c;
  const iv = setInterval(() => { c--; if (c <= 0) { clearInterval(iv); box.hidden = true; S.wantCapture = performance.now() + 1500; } else { n.textContent = c; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; } }, 1000);
});

addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "escape") { showHandbook(false); if (!$("#coach").hidden) closeTutorial(); }
  else if (k === "h") showHandbook(!$("#drawer").classList.contains("open"));
  else if (k === "?" || (k === "/" && e.shiftKey)) openTutorial();
  else if (!S.running) return;
  else if (k === "s") { const i = STYLES.findIndex((x) => x.id === S.style); for (let j = 1; j <= STYLES.length; j++) { const n = STYLES[(i + j) % STYLES.length].id; if (n !== "own" || S.sprites) { setStyle(n); break; } } }
  else if (k === "m") setMuted(!S.audio.muted);
  else if (k === "d") $("#t-debug").click();
  else if (k === "c") $("#btn-capture").click();
});
document.addEventListener("visibilitychange", () => { if (document.hidden) S.audio.setNote(null); });
addEventListener("pagehide", () => stop(true));

renderHandbook($("#handbook-body")); renderHandbook($("#drawer-body"));
buildStyleChips(); startHero($("#hero-svg"), $("#hero-cue"));
if (!store.get("tutorialDone", false)) openTutorial();
window.__db = { S, start, stop };      // handy for debugging in the console
