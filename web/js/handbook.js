// One source of truth for the handbook, rendered on the homepage AND in the in-stage drawer.
export const HANDBOOK = {
  gestures: [
    { emoji: "🤏", name: "Pinch ↔ open", does: "Brow height and shape", detail: "Thumb–index distance divided by hand size. Pinched = low U-shaped brow, open = high arch." },
    { emoji: "📐", name: "Tilt your hand", does: "Rotates the brow (±45°)", detail: "Angle from wrist to middle knuckle. Fingers straight up = level brow." },
    { emoji: "↔️", name: "Two hands apart / together", does: "Spacing between the brows", detail: "Hands about head-width apart give your natural spacing. Hands together make the brows overlap." },
    { emoji: "☝️", name: "One hand only", does: "Controls both brows", detail: "The second brow mirrors the first. Use two hands to make them disagree." },
  ],
  moods: [
    { mood: "happy", emoji: "😄", name: "Happy", recipe: "Both hands open wide, brows in a symmetric arch.", effect: "Giggle + bouncing 😄 ✨" },
    { mood: "sad", emoji: "🥺", name: "Sad", recipe: "Both hands pinched (low U), or both brows tilted with the inner ends up.", effect: "Tear drops + a sad “womp womp”" },
    { mood: "angry", emoji: "😠", name: "Angry", recipe: "Tilt both hands so the brows slope down towards your nose, like \\ /. Sad is the opposite, / \\.", effect: "Low growl + a stomp + shaking 💢" },
    { mood: "confused", emoji: "🤨", name: "Confused / goofy", recipe: "The brows disagree: one hand open and one pinched, or both tilted the same way.", effect: "Boing + floating ❓" },
  ],
  keys: [
    ["H", "Handbook"], ["?", "Replay tutorial"], ["S", "Next brow style"], ["C", "Capture my brows"],
    ["M", "Mute / unmute"], ["D", "Debug overlay"], ["Esc", "Close panels"],
  ],
  tips: [
    "Use good, even light and face the camera. Your whole face and both hands should be in view.",
    "Keep hands about arm's length from the camera and avoid overlapping them exactly. Two hands on top of each other cannot be told apart.",
    "If the face is lost for about half a second the brows hide and the sound stops. Look back at the camera.",
    "“My brows” takes a snapshot with a neutral face and warps your own brow pixels. “Hide mine” paints over your real brows with a skin-tone patch, so it can look smudgy.",
  ],
  privacy: "Everything runs in your browser. Your video is not uploaded or saved. The tracking models and scripts are downloaded from public CDNs when you press Start. A snapshot taken by “My brows” stays in memory only.",
  science: "Brow raising and lowering are standard facial Action Units (AU1 and AU2 raise, AU4 lowers). In the debug overlay the real-brow readouts come from MediaPipe's blendshapes browInnerUp, browOuterUp and browDown, which approximately correspond to them.",
  honest: "The gesture-to-mood thresholds were chosen by feel, not measured on users. Head-turn skew is approximate.",
};

export function renderHandbook(el) {
  const h = HANDBOOK;
  el.innerHTML = `
    <h3>Gestures</h3>
    <ul class="hb-list">${h.gestures.map((g) => `<li><span class="hb-emoji">${g.emoji}</span><div><b>${g.name}</b> <i>→ ${g.does}</i><p>${g.detail}</p></div></li>`).join("")}</ul>
    <h3>Moods &amp; effects</h3>
    <ul class="hb-list">${h.moods.map((m) => `<li data-mood="${m.mood}"><span class="hb-emoji">${m.emoji}</span><div><b>${m.name}</b> <i>→ ${m.effect}</i><p>${m.recipe}</p></div></li>`).join("")}</ul>
    <h3>Keys</h3>
    <div class="hb-keys">${h.keys.map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`).join("")}</div>
    <h3>Tips</h3>
    <ul class="hb-tips">${h.tips.map((t) => `<li>${t}</li>`).join("")}</ul>
    <h3>Privacy</h3><p class="hb-note">${h.privacy}</p>
    <h3>The science bit</h3><p class="hb-note">${h.science}</p>
    <p class="hb-note hb-honest">${h.honest}</p>`;
}
