"""Pure math for the brow instrument.

No webcam, no MediaPipe, only numpy, so it is easy to unit test.
Pixel coordinates: x to the right, y DOWN (like OpenCV).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# ---- Tunable starting points (chosen by feel, NOT measurements) -------------
PINCH_MIN = 0.10        # thumb-index distance / hand size when fingers touch
PINCH_MAX = 1.00        # ... when fingers are wide open
HEIGHT_MIN = 0.06       # brow centre above the eye line, as a fraction of face height
HEIGHT_MAX = 0.22
CURVE_BOWL = 1.0        # a_norm > 0: bowl shape (edges higher than centre)
CURVE_ARCH = -0.6       # a_norm < 0: arch shape
MAX_TILT_DEG = 45.0     # brow rotation is clamped to +/- this
HANDS_REF = 1.4         # hands this far apart (in face widths, roughly hands beside your head) = natural brow spacing
MAX_SPACING_SCALE = 2.0 # brows never spread wider than this x natural spacing
PERSPECTIVE_K = 0.5     # how strongly head turn shrinks the far brow (0 = off)
BROW_HALF_WIDTH = 0.17  # half the brow width, as a fraction of face width
DEFAULT_SPACING = 0.55


def clip01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def normalise(x: float, lo: float, hi: float) -> float:
    """Map x from [lo, hi] to [0, 1], clamped."""
    return clip01((x - lo) / (hi - lo))


# ---- Hand measurements -------------------------------------------------------
def hand_size(wrist, middle_mcp) -> float:
    """Wrist to middle-finger knuckle distance, used as a ruler for the hand."""
    return float(np.linalg.norm(np.asarray(middle_mcp, float) - np.asarray(wrist, float)))


def pinch_ratio(thumb_tip, index_tip, wrist, middle_mcp) -> float:
    """Thumb-index distance divided by hand size (so distance to camera cancels)."""
    size = hand_size(wrist, middle_mcp)
    if size < 1e-6:
        return 0.0
    d = np.linalg.norm(np.asarray(thumb_tip, float) - np.asarray(index_tip, float))
    return float(d / size)


def hand_tilt_deg(wrist, middle_mcp) -> float:
    """Angle of wrist -> middle knuckle. 0 = fingers up, +90 = pointing right
    (clockwise on screen), -90 = pointing left."""
    v = np.asarray(middle_mcp, float) - np.asarray(wrist, float)
    return float(np.degrees(np.arctan2(v[0], -v[1])))


# ---- Real brow (Action Unit link) -------------------------------------------
def real_brow_height(brow_y: float, eye_y: float, face_height: float) -> float:
    """Gap between the eye top and the brow, divided by face height.
    Raising the brow (AU1/AU2, inner/outer brow raiser) makes this bigger."""
    return (eye_y - brow_y) / face_height


# ---- Cartoon brow ------------------------------------------------------------
@dataclass(frozen=True)
class BrowParams:
    t: float          # 0..1 how open the fingers are
    height: float     # brow centre above eye line, fraction of face height
    curve: float      # a_norm: >0 bowl, <0 arch
    tilt_deg: float   # rotation, clockwise positive


def brow_params(pinch: float, tilt_deg: float) -> BrowParams:
    """Pinched fingers -> low brow with bowl shape. Open fingers -> high, arched."""
    t = normalise(pinch, PINCH_MIN, PINCH_MAX)
    tilt = float(np.clip(tilt_deg, -MAX_TILT_DEG, MAX_TILT_DEG))
    return BrowParams(
        t=t,
        height=lerp(HEIGHT_MIN, HEIGHT_MAX, t),
        curve=lerp(CURVE_BOWL, CURVE_ARCH, t),
        tilt_deg=tilt,
    )


def spacing_from_hands(hands_dist: float, face_w: float, natural: float = DEFAULT_SPACING) -> float:
    """Brow centre-to-centre distance (fraction of face width) from the hand-to-hand distance.

    Hands about HANDS_REF face-widths apart -> your natural brow spacing.
    Hands together -> brows overlap (0). Further apart -> wider, up to MAX_SPACING_SCALE x natural."""
    ratio = hands_dist / (HANDS_REF * face_w)
    return natural * min(max(ratio, 0.0), MAX_SPACING_SCALE)


def parabola_points(cx: float, cy: float, half_width: float, a_norm: float,
                    angle_deg: float = 0.0, n: int = 25) -> np.ndarray:
    """Points of y = a (x - xc)^2 + y0, rotated about (cx, cy).

    Maths is done with y UP (a > 0 = bowl), a = a_norm / half_width, so a_norm is
    the height of the edges above the centre in units of half_width.
    Then flipped to pixel coordinates (y down) and rotated clockwise by angle_deg.
    """
    x = np.linspace(-half_width, half_width, n)
    y_up = (a_norm / half_width) * x ** 2
    y = -y_up                                   # to pixel coordinates
    th = np.radians(angle_deg)
    xr = x * np.cos(th) - y * np.sin(th)        # clockwise on a y-down screen
    yr = x * np.sin(th) + y * np.cos(th)
    return np.stack([cx + xr, cy + yr], axis=1)


@dataclass(frozen=True)
class BrowSpec:
    """Where and how one cartoon brow sits on screen.

    eye_y / anchor_x / depth_gain describe head-turn perspective: positions on the
    far side of the head are 'further away', so vertical distances from the eye
    line shrink there (depth_factor < 1)."""
    cx: float
    cy: float
    half_width: float
    a_norm: float
    angle_deg: float
    eye_y: float = 0.0
    anchor_x: float = 0.0
    depth_gain: float = 0.0

    def depth_factor(self, x):
        return np.clip(1.0 - self.depth_gain * (np.asarray(x, dtype=float) - self.anchor_x), 0.4, 1.6)

    @property
    def depth(self) -> float:
        """Size factor at this brow's centre (use it to scale line thickness)."""
        return float(self.depth_factor(self.cx))

    def points(self, n: int = 25) -> np.ndarray:
        p = parabola_points(self.cx, self.cy, self.half_width, self.a_norm, self.angle_deg, n)
        if self.depth_gain:
            p[:, 1] = self.eye_y + (p[:, 1] - self.eye_y) * self.depth_factor(p[:, 0])
        return p


def layout_specs(params_pair, anchor_x: float, eye_y: float, face_w: float,
                 face_h: float, spacing: float, yaw_deg: float = 0.0) -> list[BrowSpec]:
    """Specs for the two cartoon brows (screen-left first).

    yaw_deg > 0 means the screen-right side of the head is further from the camera."""
    gain = float(PERSPECTIVE_K * np.sin(np.radians(yaw_deg)) / (face_w / 2))
    out = []
    for side, p in zip((-1, 1), params_pair):
        cx = anchor_x + side * spacing * face_w / 2
        spec = BrowSpec(cx=cx, cy=eye_y - p.height * face_h,
                        half_width=BROW_HALF_WIDTH * face_w, a_norm=p.curve,
                        angle_deg=p.tilt_deg, eye_y=eye_y, anchor_x=anchor_x, depth_gain=gain)
        # far brow is also narrower
        out.append(BrowSpec(**{**spec.__dict__, "half_width": spec.half_width * spec.depth}))
    return out


def layout_brows(params_pair, anchor_x, eye_y, face_w, face_h, spacing, yaw_deg=0.0) -> list[np.ndarray]:
    """Point arrays for the two cartoon brows (screen-left first)."""
    return [s.points() for s in layout_specs(params_pair, anchor_x, eye_y, face_w, face_h, spacing, yaw_deg)]


class Smoother:
    """Exponential moving average.

    alpha: fixed blend per update (frame-rate dependent, kept for simple use / tests).
    tau:   time constant in seconds; pass dt to update() and the smoothing feels the
           same at 15, 30 or 60 FPS. tau = -dt / ln(1 - alpha), so tau=0.065 matches
           the old alpha=0.4 at 30 FPS."""

    def __init__(self, alpha: float = 0.4, tau: float | None = None):
        self.alpha = alpha
        self.tau = tau
        self.value: float | None = None

    def update(self, x, dt: float | None = None):
        if self.value is None:
            self.value = x
            return x
        a = self.alpha if (self.tau is None or dt is None) else 1.0 - float(np.exp(-dt / self.tau))
        self.value = self.value + a * (x - self.value)
        return self.value


class Hold:
    """Remember the last good value for `timeout` seconds, then give up (None).

    Used so a one-frame detection dropout does not make brows flicker, but a real
    loss (you leave the frame) hides them instead of drawing at a guessed place."""

    def __init__(self, timeout: float = 0.4):
        self.timeout = timeout
        self.value = None
        self.stamp = 0.0

    def update(self, value, now: float):
        if value is not None:
            self.value, self.stamp = value, now
            return value
        if self.value is not None and now - self.stamp <= self.timeout:
            return self.value
        self.value = None
        return None
