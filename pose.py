"""Head yaw from 6 face landmarks with cv2.solvePnP and a generic 3D head model.

Better founded than the earlier cheek-depth guess, but still approximate:
the 3D model is a generic head (not yours) and the camera focal length is
assumed (= image width, roughly a 60 degree field of view).
"""
from __future__ import annotations

import numpy as np

# Generic head, arbitrary units, nose tip at the origin.
# x right, y down, z away from the camera. Order: nose, chin, eye L/R, mouth L/R.
MODEL = np.array([
    (0.0, 0.0, 0.0),
    (0.0, 330.0, 65.0),
    (-225.0, -170.0, 135.0), (225.0, -170.0, 135.0),
    (-150.0, 150.0, 125.0), (150.0, 150.0, 125.0),
], dtype=np.float64)

# FaceMesh indices: nose tip, chin, eye outer corners, mouth corners
POSE_LANDMARKS = (1, 152, 33, 263, 61, 291)


def _order(pts):
    """pts = [nose, chin, eyeA, eyeB, mouthA, mouthB] -> pairs sorted left/right by image x,
    so it does not matter whether the frame is mirrored."""
    pts = [np.asarray(p, float) for p in pts]
    eyes = sorted(pts[2:4], key=lambda p: p[0])
    mouth = sorted(pts[4:6], key=lambda p: p[0])
    return np.array([pts[0], pts[1], eyes[0], eyes[1], mouth[0], mouth[1]], dtype=np.float64)


def head_yaw_deg(pts, width: int, height: int):
    """Yaw in degrees; > 0 means the screen-right side of the head is further away.
    Returns None if the pose cannot be solved."""
    import cv2
    img = _order(pts)
    f = float(width)
    K = np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]], dtype=np.float64)
    ok, rvec, tvec = cv2.solvePnP(MODEL, img, K, None, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok or tvec[2, 0] <= 0:
        return None
    R, _ = cv2.Rodrigues(rvec)
    # The model's x axis (head 'right') in camera coordinates is R[:, 0].
    # Its z component > 0 means that side points away from the camera.
    return float(np.degrees(np.arctan2(R[2, 0], np.hypot(R[0, 0], R[1, 0]))))
