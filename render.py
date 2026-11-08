"""Drawing helpers: erase real brows, brow styles, "own brow" sprites, HUD text.

Colours are BGR (OpenCV order) and kept to a calm neutral palette.
"""
from __future__ import annotations

import cv2
import numpy as np

STYLES = ["classic", "tapered", "thin", "bold", "soft", "fuzzy", "own"]

# Neutral palette (BGR)
CHARCOAL = (52, 52, 54)
NEAR_BLACK = (28, 28, 30)
BROWN = (44, 58, 78)        # warm dark brown
TAUPE = (110, 122, 138)     # soft warm grey-brown
SAND = (150, 185, 205)      # light warm accent
HUD_TEXT = (235, 235, 235)
HUD_SHADOW = (40, 40, 40)

_FUZZ = np.random.RandomState(7).uniform(-1, 1, (64, 3, 2))   # fixed hair directions: no flicker


# ---- Erase real brows --------------------------------------------------------
def erase_brows(frame: np.ndarray, face, pad: int = 6) -> np.ndarray:
    """Paint over the real brows with cv2.inpaint (TELEA). Looks a bit smudgy."""
    h, w = frame.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for b in face.brows:
        cv2.fillConvexPoly(mask, cv2.convexHull(b.ring), 255)
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return frame
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, w)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, h)
    # Inpaint only the small region around the brows, much cheaper than the full frame.
    frame[y0:y1, x0:x1] = cv2.inpaint(frame[y0:y1, x0:x1], mask[y0:y1, x0:x1], 5, cv2.INPAINT_TELEA)
    return frame


# ---- Line-based brow styles --------------------------------------------------
def draw_brow_styled(frame, pts: np.ndarray, style: str, thickness: int,
                     inner_at_end: bool) -> None:
    """Draw one brow outline. inner_at_end=True when the end of `pts` is the
    side nearest the nose (the screen-left brow)."""
    poly = pts.astype(np.int32).reshape(-1, 1, 2)
    aa = cv2.LINE_AA
    if style == "thin":
        cv2.polylines(frame, [poly], False, TAUPE, max(2, thickness // 2), aa)
    elif style == "bold":
        cv2.polylines(frame, [poly], False, NEAR_BLACK, int(thickness * 1.7), aa)
    elif style == "tapered":
        n = len(pts)
        for i in range(n - 1):
            t = i / max(n - 2, 1)
            frac = t if inner_at_end else 1 - t          # 0 = outer tip, 1 = inner end
            w = max(1, int(thickness * (0.3 + 1.1 * frac)))
            a = (int(pts[i][0]), int(pts[i][1]))
            b = (int(pts[i + 1][0]), int(pts[i + 1][1]))
            cv2.line(frame, a, b, BROWN, w, aa)
            cv2.circle(frame, a, w // 2, BROWN, -1, aa)
    elif style == "soft":
        # warm grey brow with a blurred halo, like a soft pencil stroke
        halo = frame.copy()
        cv2.polylines(halo, [poly], False, TAUPE, thickness * 3, aa)
        halo = cv2.GaussianBlur(halo, (0, 0), max(2, thickness))
        cv2.addWeighted(halo, 0.30, frame, 0.70, 0, frame)
        cv2.polylines(frame, [poly], False, TAUPE, thickness, aa)
    elif style == "fuzzy":
        cv2.polylines(frame, [poly], False, BROWN, max(2, thickness // 2), aa)
        for i, p in enumerate(pts):
            for k in range(3):
                off = _FUZZ[i % len(_FUZZ), k] * thickness * 0.9
                a = (int(p[0]), int(p[1]))
                b = (int(p[0] + off[0]), int(p[1] + off[1]))
                cv2.line(frame, a, b, BROWN, 1, aa)
    else:  # classic
        cv2.polylines(frame, [poly], False, CHARCOAL, thickness, aa)


# ---- "Own brow": capture a real brow and warp it along the parabola -----------
def capture_brow_sprites(frame, face, pad: int = 6) -> list:
    """Cut each real brow out of the (not yet erased) frame as a BGRA sprite
    with a feathered edge. Returns [screen-left sprite, screen-right sprite]."""
    h, w = frame.shape[:2]
    sprites = []
    for b in face.brows:
        mask = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(mask, cv2.convexHull(b.ring), 255)
        mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
        x, y, bw, bh = cv2.boundingRect(b.ring)
        x0, y0 = max(x - pad, 0), max(y - pad, 0)
        x1, y1 = min(x + bw + pad, w), min(y + bh + pad, h)
        alpha = cv2.GaussianBlur(mask[y0:y1, x0:x1], (7, 7), 0)
        sprites.append(np.dstack([frame[y0:y1, x0:x1].copy(), alpha]))
    return sprites


def draw_sprite(frame, sprite: np.ndarray, spec) -> None:
    """Warp a brow sprite onto the parabola described by spec (a BrowSpec).

    Inverse mapping: for every output pixel, find where it came from in the sprite.
    The head-turn perspective (spec.depth_gain) is undone first, so the far side
    of the brow comes out thinner."""
    hs, ws = sprite.shape[:2]
    hw, a = spec.half_width, spec.a_norm
    s = ws / (2 * hw)                                   # sprite px per screen px
    fh, fw = frame.shape[:2]
    f_c = spec.depth                                    # perspective factor at the brow centre
    cy_screen = spec.eye_y + (spec.cy - spec.eye_y) * f_c if spec.depth_gain else spec.cy
    r = int(1.2 * np.hypot(hw, abs(a) * hw + hs / s) * (1.6 if spec.depth_gain else 1.0)) + 4
    x0, y0 = max(int(spec.cx) - r, 0), max(int(cy_screen) - r, 0)
    x1, y1 = min(int(spec.cx) + r, fw), min(int(cy_screen) + r, fh)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return
    px, py = np.meshgrid(np.arange(x0, x1, dtype=np.float32), np.arange(y0, y1, dtype=np.float32))
    if spec.depth_gain:                                 # undo perspective (x is unchanged by it)
        py = spec.eye_y + (py - spec.eye_y) / spec.depth_factor(px)
    u, v = px - spec.cx, py - spec.cy
    th = np.radians(spec.angle_deg)
    x = u * np.cos(th) + v * np.sin(th)                 # undo the rotation
    y = -u * np.sin(th) + v * np.cos(th)
    y_curve = -(a / hw) * x ** 2                        # pixel-space parabola offset
    map_x = (x * s + ws / 2).astype(np.float32)
    map_y = ((y - y_curve) * s + hs / 2).astype(np.float32)
    warped = cv2.remap(sprite, map_x, map_y, cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    alpha = warped[..., 3:4].astype(np.float32) / 255.0
    roi = frame[y0:y1, x0:x1]
    roi[:] = (warped[..., :3] * alpha + roi * (1 - alpha)).astype(np.uint8)


# ---- Debug + HUD -------------------------------------------------------------
_HAND_BONES = ((0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
               (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16),
               (13, 17), (17, 18), (18, 19), (19, 20), (0, 17))


def draw_hand_debug(frame, hand) -> None:
    """Quiet grey skeleton, with the thumb-index line in a warm accent."""
    h, w = frame.shape[:2]
    pts = [(int(l.x * w), int(l.y * h)) for l in hand.raw.landmark]
    for i, j in _HAND_BONES:
        cv2.line(frame, pts[i], pts[j], (175, 175, 175), 1, cv2.LINE_AA)
    for p in pts:
        cv2.circle(frame, p, 2, (235, 235, 235), -1, cv2.LINE_AA)
    cv2.line(frame, tuple(hand.thumb_tip.astype(int)), tuple(hand.index_tip.astype(int)),
             SAND, 2, cv2.LINE_AA)


def draw_hud(frame, lines, color=HUD_TEXT) -> None:
    for i, text in enumerate(lines):
        cv2.putText(frame, text, (10, 24 + 24 * i), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, HUD_SHADOW, 3, cv2.LINE_AA)
        cv2.putText(frame, text, (10, 24 + 24 * i), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, color, 1, cv2.LINE_AA)
