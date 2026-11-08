// Canvas drawing: video, brow styles, "my brows" warp, hide-my-brows patch, hand debug, demo face.
export const STYLES = [
  { id: "classic", label: "Classic" }, { id: "tapered", label: "Tapered" }, { id: "thin", label: "Thin" },
  { id: "bold", label: "Bold" }, { id: "soft", label: "Soft" }, { id: "fuzzy", label: "Fuzzy" }, { id: "own", label: "My brows" },
];
export const COLORS = { classic: "#343436", tapered: "#4e3a2c", thin: "#8a7a6e", bold: "#18181a", soft: "#8a7a6e", fuzzy: "#4e3a2c" };

const path = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };
// Fixed pseudo-random hair directions so the fuzzy style does not flicker.
const FUZZ = Array.from({ length: 64 }, (_, i) => [0, 1, 2].map((k) => [Math.sin((i + 1) * 12.9898 + k * 78.233) , Math.cos((i + 1) * 4.1414 + k * 9.17)]));

export function drawVideoMirrored(ctx, video, W, H) {
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, W, H); ctx.restore();
}

/** innerAtEnd: the last point of `pts` is the end nearest the nose (the left brow). */
export function drawBrow(ctx, pts, style, thickness, innerAtEnd) {
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  const col = COLORS[style] || COLORS.classic;
  if (style === "tapered") {
    ctx.fillStyle = col;
    for (let i = 0; i < pts.length - 1; i++) {
      const t = i / Math.max(pts.length - 2, 1), frac = innerAtEnd ? t : 1 - t;
      const w = Math.max(1, thickness * (0.3 + 1.1 * frac));
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(...pts[i]); ctx.lineTo(...pts[i + 1]); ctx.stroke();
    }
  } else if (style === "soft") {
    ctx.shadowColor = col; ctx.shadowBlur = thickness * 2.2; ctx.strokeStyle = col; ctx.lineWidth = thickness; path(ctx, pts); ctx.globalAlpha = 0.85; ctx.stroke();
  } else if (style === "fuzzy") {
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, thickness / 2); path(ctx, pts); ctx.stroke();
    ctx.lineWidth = 1; pts.forEach((p, i) => FUZZ[i % 64].forEach(([dx, dy]) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + dx * thickness * 0.9, p[1] + dy * thickness * 0.9); ctx.stroke(); }));
  } else {
    ctx.strokeStyle = col; ctx.lineWidth = style === "thin" ? Math.max(2, thickness / 2) : style === "bold" ? thickness * 1.7 : thickness;
    path(ctx, pts); ctx.stroke();
  }
  ctx.restore();
}

// ---- "My brows": snapshot your real brow, then warp it along the parabola -------------------
function hull(points) {                                         // monotone chain convex hull
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Crop each brow from what is currently on the canvas (call right after drawing the video). */
export function captureBrowSprites(ctx, face, pad = 8) {
  return face.brows.map((b) => {
    const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
    const w = Math.max(4, Math.ceil(Math.max(...xs) - x0 + pad)), h = Math.max(4, Math.ceil(Math.max(...ys) - y0 + pad));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d");
    c.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
    // feathered alpha: keep only a soft-edged brow-shaped region
    const mask = document.createElement("canvas"); mask.width = w; mask.height = h;
    const m = mask.getContext("2d");
    m.shadowColor = "#000"; m.shadowBlur = 6; m.fillStyle = "#000";
    path(m, hull(b.ring).map((p) => [p[0] - x0, p[1] - y0])); m.closePath(); m.fill();
    c.globalCompositeOperation = "destination-in"; c.drawImage(mask, 0, 0);
    return cv;
  });
}

/** Warp a sprite along the brow's parabola using thin vertical strips (cheap, no per-pixel work). */
export function drawSprite(ctx, sprite, spec, strips = 26) {
  const sw = sprite.width, sh = sprite.height, hw = spec.halfWidth;
  if (!(hw > 2) || sw < 4) return;
  const k = (2 * hw) / sw, th = (spec.angleDeg * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
  const stripSrc = sw / strips;
  for (let i = 0; i < strips; i++) {
    const x = -hw + ((i + 0.5) * 2 * hw) / strips;
    const y = -(spec.aNorm / hw) * x * x, slope = -2 * (spec.aNorm / hw) * x;
    let sx = spec.cx + x * cos - y * sin, sy = spec.cy + x * sin + y * cos;
    const f = spec.depthGain ? spec.depthFactor(sx) : 1;
    if (spec.depthGain) sy = spec.eyeY + (sy - spec.eyeY) * f;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(th + Math.atan(slope));
    ctx.drawImage(sprite, i * stripSrc, 0, stripSrc, sh, -(stripSrc * k) / 2 - 0.5, (-sh * k * f) / 2, stripSrc * k + 1, sh * k * f);
    ctx.restore();
  }
}

/** Paint over the real brows with a skin-tone patch sampled just above them. Can look smudgy. */
export function hideBrows(ctx, face) {
  for (const b of face.brows) {
    const xs = b.ring.map((p) => p[0]), ys = b.ring.map((p) => p[1]);
    const top = Math.min(...ys), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    let r = 200, g = 160, bl = 140;
    try {
      const d = ctx.getImageData(Math.max(0, cx - 12), Math.max(0, top - 22), 24, 8).data;
      r = g = bl = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
      r /= n; g /= n; bl /= n;
    } catch { /* canvas read blocked: fall back to a neutral skin tone */ }
    ctx.save();
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    path(ctx, hull(b.ring).map((p) => [cx + (p[0] - cx) * 1.15, p[1]])); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
export function drawHandDebug(ctx, hand) {
  ctx.save(); ctx.strokeStyle = "rgba(244,239,230,.55)"; ctx.lineWidth = 1.5;
  for (const [a, b] of BONES) { ctx.beginPath(); ctx.moveTo(...hand.pts[a]); ctx.lineTo(...hand.pts[b]); ctx.stroke(); }
  ctx.fillStyle = "#f4efe6"; for (const p of hand.pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, 6.3); ctx.fill(); }
  ctx.strokeStyle = "#ffb38a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...hand.thumbTip); ctx.lineTo(...hand.indexTip); ctx.stroke();
  ctx.restore();
}

/** Illustrated face for demo mode (no camera). mood just changes the mouth. */
export function drawDemoFace(ctx, face, W, H, mood) {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.5, H);
  g.addColorStop(0, "#1b1d24"); g.addColorStop(1, "#06070a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const cx = face.anchorX, cy = face.eyeY + face.faceH * 0.18, rx = face.faceW * 0.52, ry = face.faceH * 0.62;
  ctx.fillStyle = "#e9c3a4"; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 6.3); ctx.fill();
  const yawShift = face.yawDeg * 0.5;
  ctx.fillStyle = "#2b2b2f";
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * face.faceW * 0.26 + yawShift * 0.3, face.eyeY, face.faceW * 0.045, face.faceH * 0.035, 0, 0, 6.3); ctx.fill(); }
  ctx.strokeStyle = "#a9715a"; ctx.lineWidth = 4; ctx.lineCap = "round";
  const my = face.eyeY + face.faceH * 0.38, mw = face.faceW * 0.2, bend = mood === "happy" ? 1 : mood === "sad" ? -1 : mood === "confused" ? 0.2 : 0.25;
  ctx.beginPath(); ctx.moveTo(cx - mw + yawShift * 0.2, my); ctx.quadraticCurveTo(cx + yawShift * 0.2, my + bend * face.faceH * 0.1, cx + mw + yawShift * 0.2, my + (mood === "confused" ? -6 : 0)); ctx.stroke();
  ctx.fillStyle = "rgba(240,140,140,.35)";
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * face.faceW * 0.33, face.eyeY + face.faceH * 0.2, face.faceW * 0.07, face.faceH * 0.04, 0, 0, 6.3); ctx.fill(); }
}
