import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
pytest.importorskip("cv2")

from brow import BrowSpec
from render import draw_sprite


def _red_sprite():
    sp = np.zeros((20, 100, 4), np.uint8)
    sp[..., 2] = 255
    sp[..., 3] = 255
    return sp


def _extent(spec):
    frame = np.zeros((300, 300, 3), np.uint8)
    draw_sprite(frame, _red_sprite(), spec)
    ys, xs = np.nonzero(frame[..., 2] > 200)
    return xs.min(), xs.max(), ys.min(), ys.max()


def test_flat_sprite_keeps_its_size():
    x0, x1, y0, y1 = _extent(BrowSpec(150, 150, 50, 0.0, 0))
    assert 95 <= x1 - x0 + 1 <= 105 and 15 <= y1 - y0 + 1 <= 25


def test_bowl_lifts_the_edges():
    flat = _extent(BrowSpec(150, 150, 50, 0.0, 0))
    bowl = _extent(BrowSpec(150, 150, 50, 1.0, 0))
    assert bowl[2] < flat[2] - 30        # top edge is much higher on screen


def test_rotating_90_degrees_makes_it_tall():
    x0, x1, y0, y1 = _extent(BrowSpec(150, 150, 50, 0.0, 90))
    assert (y1 - y0) > 4 * (x1 - x0)


def test_perspective_makes_far_end_of_sprite_thinner():
    spec = BrowSpec(150, 150, 50, 0.0, 0, eye_y=150, anchor_x=150, depth_gain=0.008)  # right side far
    frame = np.zeros((300, 300, 3), np.uint8)
    draw_sprite(frame, _red_sprite(), spec)
    mask = frame[..., 2] > 200
    left_h = mask[:, 105:115].sum(axis=0).mean()
    right_h = mask[:, 185:195].sum(axis=0).mean()
    assert right_h < left_h * 0.8
