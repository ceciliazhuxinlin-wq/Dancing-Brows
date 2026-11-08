import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio import F_HIGH, F_LOW, NoteSnapper, height_to_freq, scale_freqs
from brow import (HANDS_REF, MAX_SPACING_SCALE, Smoother, brow_params, hand_tilt_deg,
                  layout_specs, parabola_points, pinch_ratio, real_brow_height,
                  spacing_from_hands)


def test_pinch_ratio_ignores_distance_to_camera():
    near = pinch_ratio((10, 0), (30, 0), (0, 100), (0, 0))
    far = pinch_ratio((30, 0), (90, 0), (0, 300), (0, 0))   # everything 3x bigger
    assert np.isclose(near, far)


def test_hand_tilt_angles():
    assert np.isclose(hand_tilt_deg((0, 0), (0, -1)), 0)     # fingers up
    assert np.isclose(hand_tilt_deg((0, 0), (1, 0)), 90)     # pointing right
    assert np.isclose(hand_tilt_deg((0, 0), (-1, 0)), -90)   # pointing left


def test_bowl_has_edges_higher_than_centre():
    pts = parabola_points(100, 100, 50, a_norm=1.0)
    mid = len(pts) // 2
    assert pts[0, 1] < pts[mid, 1] and pts[-1, 1] < pts[mid, 1]   # smaller y = higher on screen


def test_arch_has_edges_lower_than_centre():
    pts = parabola_points(100, 100, 50, a_norm=-0.6)
    mid = len(pts) // 2
    assert pts[0, 1] > pts[mid, 1]


def test_rotation_90_degrees_makes_flat_brow_vertical():
    pts = parabola_points(100, 100, 50, a_norm=0.0, angle_deg=90)
    assert np.allclose(pts[:, 0], 100, atol=1e-6)
    assert np.isclose(pts[:, 1].max() - pts[:, 1].min(), 100)


def test_pinched_is_low_bowl_open_is_high_arch():
    pinched, open_ = brow_params(0.0, 0), brow_params(5.0, 0)
    assert pinched.curve > 0 > open_.curve
    assert pinched.height < open_.height


def test_real_brow_height_ignores_face_size():
    assert np.isclose(real_brow_height(90, 100, 200), real_brow_height(180, 200, 400))


def test_hands_at_head_width_give_natural_brow_spacing():
    face_w = 200.0
    assert np.isclose(spacing_from_hands(HANDS_REF * face_w, face_w, natural=0.55), 0.55)


def test_hands_together_make_brows_overlap():
    assert spacing_from_hands(0.0, 200.0, natural=0.55) == 0.0
    assert spacing_from_hands(5.0, 200.0, natural=0.55) < 0.01


def test_hands_further_apart_means_brows_further_apart_but_capped():
    face_w = 200.0
    a, b = spacing_from_hands(150, face_w), spacing_from_hands(350, face_w)
    assert a < b
    assert np.isclose(spacing_from_hands(1e6, face_w, natural=0.5), 0.5 * MAX_SPACING_SCALE)


def test_pitch_mapping_range_and_order():
    assert np.isclose(height_to_freq(0), F_LOW) and np.isclose(height_to_freq(1), F_HIGH)
    assert F_LOW < 150 and F_HIGH < 600          # low register, not shrill
    assert height_to_freq(0.3) < height_to_freq(0.6)


def test_scale_is_pentatonic_and_in_range():
    notes = scale_freqs()
    assert np.isclose(notes[0], F_LOW, rtol=0.01) and np.isclose(notes[-1], F_HIGH, rtol=0.01)
    assert all(a < b for a, b in zip(notes, notes[1:]))
    semis = {round(12 * np.log2(f / notes[0])) % 12 for f in notes}
    assert semis == {0, 2, 4, 7, 9}


def test_note_snapper_does_not_flutter_on_a_border():
    sn = NoteSnapper()
    n = len(sn.notes) - 1
    first = sn.freq(0.5)
    border = (sn.idx + 0.5) / n                   # exactly between two notes
    assert sn.freq(border + 0.01) == first        # small wobble keeps the same note
    assert sn.freq(border - 0.01) == first


def _specs(yaw):
    pair = [brow_params(0.5, 0), brow_params(0.5, 0)]
    return layout_specs(pair, anchor_x=300, eye_y=200, face_w=200, face_h=260, spacing=0.55, yaw_deg=yaw)


def test_no_head_turn_means_no_skew():
    left, right = _specs(0.0)
    assert left.depth == 1.0 and right.depth == 1.0
    assert np.isclose(left.half_width, right.half_width)


def test_turned_head_shrinks_the_far_brow():
    left, right = _specs(30.0)                    # right side of the head is further away
    assert right.depth < 1.0 < left.depth
    assert right.half_width < left.half_width
    # far brow sits closer to the eye line than the near brow does
    assert abs(right.points()[:, 1].mean() - 200) < abs(left.points()[:, 1].mean() - 200)


def test_turning_the_other_way_flips_it():
    left, right = _specs(-30.0)
    assert left.depth < 1.0 < right.depth


def test_smoother_moves_toward_target():
    s = Smoother(0.5)
    s.update(0.0)
    assert s.update(1.0) == 0.5


def test_brow_spec_points_match_parabola():
    from brow import BrowSpec
    spec = BrowSpec(100, 100, 50, 0.7, 20)
    assert np.allclose(spec.points(), parabola_points(100, 100, 50, 0.7, 20))
