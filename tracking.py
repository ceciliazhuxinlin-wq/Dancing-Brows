"""MediaPipe face + hand tracking. Turns raw landmarks into plain numbers."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
import mediapipe as mp

from brow import hand_tilt_deg, pinch_ratio, real_brow_height
from identity import SlotAssigner
from pose import POSE_LANDMARKS, head_yaw_deg

# FaceMesh landmark indices for the two brows (same-side eye-top point alongside).
_FACE_GROUPS = (
    dict(upper=[70, 63, 105, 66, 107], lower=[46, 53, 52, 65, 55], brow=105, eye=159),
    dict(upper=[300, 293, 334, 296, 336], lower=[276, 283, 282, 295, 285], brow=334, eye=386),
)
_FOREHEAD, _CHIN, _CHEEK_A, _CHEEK_B = 10, 152, 234, 454


@dataclass
class BrowInfo:
    ring: np.ndarray      # (N, 2) int32 px outline of the real brow (for erasing)
    cx: float             # brow centre x (px)
    height: float         # real brow height, normalised by face height


@dataclass
class FaceData:
    brows: list           # BrowInfo, screen-left first
    face_h: float
    face_w: float
    anchor_x: float       # x midpoint between the brows
    eye_y: float          # mean eye-top y
    yaw_deg: float = 0.0  # head turn; > 0 = screen-right side of the face is further away


@dataclass
class HandData:
    center: np.ndarray    # knuckle (landmark 9) px
    thumb_tip: np.ndarray
    index_tip: np.ndarray
    pinch: float          # thumb-index distance / hand size
    tilt_deg: float
    raw: object = field(default=None, repr=False)   # MediaPipe landmarks, for drawing
    slot: int = 0         # stable identity: 0 drives the left brow, 1 the right brow


@dataclass
class TrackResult:
    face: FaceData | None
    hands: list           # HandData ordered by slot (identity), not by screen position


class Tracker:
    def __init__(self):
        self._face = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1, refine_landmarks=True,
            min_detection_confidence=0.5, min_tracking_confidence=0.5)
        self._hands = mp.solutions.hands.Hands(
            max_num_hands=2, min_detection_confidence=0.6, min_tracking_confidence=0.5)
        self._slots = SlotAssigner(n_slots=2, max_missed=8)
        self._closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def process(self, frame_bgr: np.ndarray) -> TrackResult:
        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        return TrackResult(self._face_data(rgb, w, h), self._hand_data(rgb, w, h))

    def _face_data(self, rgb, w, h):
        res = self._face.process(rgb)
        if not res.multi_face_landmarks:
            return None
        lm = res.multi_face_landmarks[0].landmark
        P = lambda i: np.array([lm[i].x * w, lm[i].y * h])
        face_h = float(np.linalg.norm(P(_FOREHEAD) - P(_CHIN)))
        face_w = float(np.linalg.norm(P(_CHEEK_A) - P(_CHEEK_B)))
        brows, eye_ys = [], []
        for g in _FACE_GROUPS:
            ring = np.array([P(i) for i in g["upper"] + g["lower"]]).astype(np.int32)
            brows.append(BrowInfo(
                ring=ring,
                cx=float(ring[:, 0].mean()),
                height=real_brow_height(P(g["brow"])[1], P(g["eye"])[1], face_h)))
            eye_ys.append(P(g["eye"])[1])
        # Head turn: solvePnP on 6 landmarks against a generic head model.
        # Falls back to the cheek depth difference if the pose cannot be solved.
        yaw = head_yaw_deg([P(i) for i in POSE_LANDMARKS], w, h)
        if yaw is None:
            left, right = sorted((lm[_CHEEK_A], lm[_CHEEK_B]), key=lambda q: q.x)
            yaw = math.degrees(math.atan2(right.z - left.z, right.x - left.x))
        brows.sort(key=lambda b: b.cx)   # screen-left first (frame is already mirrored)
        return FaceData(brows, face_h, face_w,
                        anchor_x=float(np.mean([b.cx for b in brows])),
                        eye_y=float(np.mean(eye_ys)), yaw_deg=yaw)

    def _hand_data(self, rgb, w, h):
        res = self._hands.process(rgb)
        hands = []
        for hl in res.multi_hand_landmarks or []:
            p = lambda i: np.array([hl.landmark[i].x * w, hl.landmark[i].y * h])
            hands.append(HandData(
                center=p(9), thumb_tip=p(4), index_tip=p(8),
                pinch=pinch_ratio(p(4), p(8), p(0), p(9)),
                tilt_deg=hand_tilt_deg(p(0), p(9)),
                raw=hl))
        # Identity by continuity (not by screen x), so crossing hands do not swap brows.
        slots = self._slots.update([hd.center for hd in hands], max_jump=0.4 * w)
        kept = []
        for hd, slot in zip(hands, slots):
            if slot is not None:
                hd.slot = slot
                kept.append(hd)
        kept.sort(key=lambda hd: hd.slot)
        return kept

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._face.close()
        self._hands.close()
