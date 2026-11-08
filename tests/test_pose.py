import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
cv2 = pytest.importorskip("cv2")

from pose import MODEL, head_yaw_deg

W, H = 640, 480


def _project(yaw_true_deg, pitch_deg=0.0, noise=0.0, seed=0, mirror=False):
    """Rotate the generic head about its vertical axis, project it with a pinhole camera."""
    rvec_y = np.array([0.0, np.radians(yaw_true_deg), 0.0])
    Ry, _ = cv2.Rodrigues(rvec_y)
    Rx, _ = cv2.Rodrigues(np.array([np.radians(pitch_deg), 0.0, 0.0]))
    R = Ry @ Rx
    t = np.array([0.0, 0.0, 1500.0])
    cam = MODEL @ R.T + t
    K = np.array([[W, 0, W / 2], [0, W, H / 2], [0, 0, 1.0]])
    img = (cam @ K.T)
    img = img[:, :2] / img[:, 2:3]
    img += np.random.RandomState(seed).normal(0, noise, img.shape)
    if mirror:
        img[:, 0] = W - img[:, 0]
    return img, cam


def test_frontal_face_has_zero_yaw():
    img, _ = _project(0.0)
    assert abs(head_yaw_deg(img, W, H)) < 1.0


@pytest.mark.parametrize("true", [-35, -15, 15, 35])
def test_recovers_a_known_yaw_without_noise(true):
    img, cam = _project(true)
    got = head_yaw_deg(img, W, H)
    # sign convention: yaw > 0 means the head's right side (model x > 0) is further from the camera
    far_right = cam[3, 2] > cam[2, 2]
    assert (got > 0) == far_right
    assert abs(abs(got) - abs(true)) < 1.5


def test_yaw_with_one_pixel_of_landmark_noise_is_roughly_right():
    errs = []
    for seed in range(20):
        img, _ = _project(25.0, noise=1.0, seed=seed)
        errs.append(abs(abs(head_yaw_deg(img, W, H)) - 25.0))
    assert np.median(errs) < 6.0          # honest tolerance: it is approximate


def test_mirrored_image_flips_the_sign():
    img, _ = _project(25.0)
    mirrored = img.copy()
    mirrored[:, 0] = W - mirrored[:, 0]
    assert head_yaw_deg(img, W, H) * head_yaw_deg(mirrored, W, H) < 0
