// Tracking layer. Two interchangeable trackers return the same shape:
//   { face, hands }  in CANVAS pixels, already mirrored like a selfie camera.
// - createTracker(): real MediaPipe FaceLandmarker + HandLandmarker (needs a camera and network for the models)
// - createDemoTracker(): scripted face and hands, no camera needed
import { handTiltDeg, pinchRatio, realBrowHeight, dist } from "./brow.js";
import { SlotAssigner } from "./identity.js";
import { demoScript } from "./demo.js";

const VER = "0.10.3";   // the version used in Google's own web samples
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODELS = {
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
};
// FaceMesh indices: brow upper/lower outline, brow + eye-top points, forehead, chin, cheeks
const BROWS = [
  { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55], brow: 105, eye: 159 },
  { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285], brow: 334, eye: 386 },
];
const FOREHEAD = 10, CHIN = 152, CHEEK_A = 234, CHEEK_B = 454;

async function loadVision() {
  try { return await import(`${CDN}/vision_bundle.mjs`); }
  catch { const m = await import(CDN); return m.default ?? m; }
}

const finitePos = (...xs) => xs.every((x) => Number.isFinite(x) && x > 20);

/** Shared by the live tracker: landmarks (normalised, un-mirrored) -> face data in canvas px. */
export function faceFromLandmarks(lm, W, H, blend) {
  const P = (i) => [(1 - lm[i].x) * W, lm[i].y * H];
  const faceH = dist(P(FOREHEAD), P(CHIN)), faceW = dist(P(CHEEK_A), P(CHEEK_B));
  if (!finitePos(faceH, faceW)) return null;                    // reject garbage before dividing by it
  const brows = BROWS.map((g) => {
    const ring = [...g.upper, ...g.lower].map(P);
    return { ring, cx: ring.reduce((a, p) => a + p[0], 0) / ring.length, height: realBrowHeight(P(g.brow)[1], P(g.eye)[1], faceH), eyeY: P(g.eye)[1] };
  }).sort((a, b) => a.cx - b.cx);
  // Head turn from the depth difference between the cheeks (z has about the same scale as x).
  const [l, r] = [CHEEK_A, CHEEK_B].map((i) => ({ sx: 1 - lm[i].x, z: lm[i].z })).sort((a, b) => a.sx - b.sx);
  const yawDeg = (Math.atan2(r.z - l.z, r.sx - l.sx) * 180) / Math.PI;
  let au = null;
  if (blend) {
    au = {};
    for (const c of blend.categories) au[c.categoryName] = c.score;
  }
  return { brows, faceW, faceH, anchorX: (brows[0].cx + brows[1].cx) / 2, eyeY: (brows[0].eyeY + brows[1].eyeY) / 2, yawDeg: Number.isFinite(yawDeg) ? yawDeg : 0, au };
}

export function handFromLandmarks(lm, W, H) {
  const pts = lm.map((q) => [(1 - q.x) * W, q.y * H]);
  return { center: pts[9], thumbTip: pts[4], indexTip: pts[8], pts, pinch: pinchRatio(pts[4], pts[8], pts[0], pts[9]), tiltDeg: handTiltDeg(pts[0], pts[9]), slot: 0 };
}

export async function createTracker({ onStatus = () => {} } = {}) {
  onStatus("loading instrument…");
  const vision = await loadVision();
  const { FaceLandmarker, HandLandmarker, FilesetResolver } = vision;
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = async (Cls, model, opts) => {
    try { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate: "GPU" }, runningMode: "VIDEO", ...opts }); }
    catch { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate: "CPU" }, runningMode: "VIDEO", ...opts }); }
  };
  onStatus("loading face model…");
  const face = await make(FaceLandmarker, MODELS.face, { numFaces: 1, outputFaceBlendshapes: true });
  onStatus("loading hand model…");
  const hand = await make(HandLandmarker, MODELS.hand, { numHands: 2 });
  const slots = new SlotAssigner(2, 8);
  let lastTs = 0;
  return {
    kind: "live",
    process(video, W, H, nowMs) {
      const ts = Math.max(nowMs, lastTs + 1); lastTs = ts;            // timestamps must strictly increase
      const f = face.detectForVideo(video, ts), h = hand.detectForVideo(video, ts);
      const faceData = f.faceLandmarks?.length ? faceFromLandmarks(f.faceLandmarks[0], W, H, f.faceBlendshapes?.[0]) : null;
      const hands = (h.landmarks || []).map((lm) => handFromLandmarks(lm, W, H));
      const ids = slots.update(hands.map((x) => x.center), 0.4 * W);   // identity by continuity, not by screen x
      const kept = [];
      hands.forEach((x, i) => { if (ids[i] !== null) { x.slot = ids[i]; kept.push(x); } });
      kept.sort((a, b) => a.slot - b.slot);
      return { face: faceData, hands: kept };
    },
    close() { try { face.close(); hand.close(); } catch { /* already closed */ } },
  };
}

/** Scripted tracker: same output shape, no camera, no network. */
export function createDemoTracker() {
  return {
    kind: "demo",
    process(_video, W, H, nowMs) {
      const s = demoScript(nowMs / 1000);
      const faceH = Math.min(0.5 * H, 0.62 * W), faceW = 0.8 * faceH, ax = W / 2 + 14 * Math.sin(s.yaw * Math.PI / 180) * 3, eyeY = 0.4 * H;
      const mk = (side) => {
        const cx = ax + side * 0.275 * faceW, cy = eyeY - 0.1 * faceH;
        return { cx, eyeY, height: 0.1, ring: [[cx - 28, cy - 8], [cx + 28, cy - 8], [cx + 28, cy + 8], [cx - 28, cy + 8]] };
      };
      const face = { brows: [mk(-1), mk(1)], faceW, faceH, anchorX: ax, eyeY, yawDeg: s.yaw, au: null };
      const hands = [0, 1].map((slot) => {
        const size = 0.16 * H, cx = W / 2 + (slot ? 1 : -1) * s.dist * faceW / 2, cy = 0.66 * H;
        const th = (s.tilt[slot] * Math.PI) / 180, wrist = [cx, cy + size / 2];
        const mcp = [wrist[0] + size * Math.sin(th), wrist[1] - size * Math.cos(th)];
        const tip = (dx) => [mcp[0] + dx + 0.5 * size * Math.sin(th), mcp[1] - 0.6 * size * Math.cos(th)];
        const thumbTip = tip(-s.pinch[slot] * size / 2), indexTip = tip(s.pinch[slot] * size / 2);
        const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        const pts = Array(21).fill(wrist);
        const chain = (i0, base, tipP) => { for (let k = 0; k < 4; k++) pts[i0 + k] = lerp2(base, tipP, (k + 1) / 4); };
        chain(1, lerp2(wrist, mcp, 0.3), thumbTip); chain(5, mcp, indexTip);
        chain(9, mcp, [mcp[0] + 0.3 * size * Math.sin(th), mcp[1] - 1.1 * size * Math.cos(th)]);
        chain(13, lerp2(mcp, wrist, -0.0), [mcp[0] + 0.25 * size, mcp[1] - 1.0 * size * Math.cos(th)]);
        chain(17, lerp2(mcp, wrist, 0.0), [mcp[0] + 0.5 * size, mcp[1] - 0.8 * size * Math.cos(th)]);
        pts[0] = wrist; pts[9] = mcp;
        return { center: mcp, thumbTip, indexTip, pts, pinch: pinchRatio(thumbTip, indexTip, wrist, mcp), tiltDeg: handTiltDeg(wrist, mcp), slot };
      });
      return { face, hands };
    },
    close() {},
  };
}
