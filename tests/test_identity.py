import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from identity import SlotAssigner

GATE = 256.0


def test_first_two_hands_get_slots_by_screen_order():
    a = SlotAssigner()
    assert a.update([(500, 200), (100, 200)], GATE) == [1, 0]   # detection order does not matter


def test_crossing_hands_keep_their_identity():
    a = SlotAssigner()
    left_start, right_start = 100.0, 500.0
    a.update([(left_start, 200), (right_start, 240)], GATE)      # slot 0 = left hand, slot 1 = right hand
    for step in range(1, 21):                                   # hands move through each other
        x_l, x_r = left_start + 20 * step, right_start - 20 * step
        out = a.update([(x_r, 240), (x_l, 200)], GATE)          # shuffled detection order
        assert out[1] == 0 and out[0] == 1, f"swapped at step {step}"
    # after crossing: the original left hand (slot 0) is now on the right of the screen
    assert a.pos[0][0] > a.pos[1][0]


def test_short_dropout_keeps_identity():
    a = SlotAssigner(max_missed=8)
    a.update([(100, 200), (500, 200)], GATE)
    for _ in range(5):
        a.update([(500, 200)], GATE)                            # left hand lost for 5 frames
    assert a.update([(105, 200), (500, 200)], GATE) == [0, 1]


def test_long_dropout_frees_the_slot():
    a = SlotAssigner(max_missed=3)
    a.update([(100, 200), (500, 200)], GATE)
    for _ in range(5):
        a.update([(500, 200)], GATE)
    assert a.pos[0] is None and a.pos[1] is not None


def test_single_hand_then_second_hand_on_the_left_gets_slot_zero():
    a = SlotAssigner()
    assert a.update([(500, 200)], GATE) == [0]                  # first hand takes slot 0 (on the right)
    out = a.update([(500, 200), (100, 200)], GATE)              # a hand appears on the left
    assert out == [1, 0]                                        # slots relabelled to match screen order


def test_hand_that_jumps_far_is_treated_as_a_new_hand():
    a = SlotAssigner()
    a.update([(100, 200)], GATE)
    out = a.update([(600, 200)], GATE)                          # farther than the gate
    assert out == [1]


def test_three_detections_never_crash_and_use_at_most_two_slots():
    a = SlotAssigner()
    out = a.update([(50, 0), (300, 0), (600, 0)], GATE)
    assert sorted(x for x in out if x is not None) == [0, 1]
    assert a.update([], GATE) == []


def test_exactly_overlapping_hands_stay_valid_even_if_ambiguous():
    a = SlotAssigner()
    a.update([(100, 200), (500, 200)], GATE)
    out = a.update([(300, 200), (300, 200)], GATE)               # truly indistinguishable
    assert sorted(out) == [0, 1]                                 # still one detection per slot
