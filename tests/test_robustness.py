import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brow import Hold, Smoother
from camera import CameraError, open_camera, read_frame


# ---- time-based smoothing ----------------------------------------------------
def _settle(fps, seconds=0.2, tau=0.065):
    s = Smoother(tau=tau)
    s.update(0.0, 1 / fps)
    for _ in range(int(round(seconds * fps))):
        s.update(1.0, 1 / fps)
    return s.value


def test_smoothing_is_the_same_at_15_30_and_60_fps():
    v15, v30, v60 = _settle(15), _settle(30), _settle(60)
    assert abs(v15 - v30) < 0.01 and abs(v60 - v30) < 0.01
    assert 0.9 < v30 < 0.99                     # 0.2 s is about 3 time constants


def test_tau_matches_the_old_alpha_at_30fps():
    s = Smoother(tau=0.065)
    s.update(0.0, 1 / 30)
    assert abs(s.update(1.0, 1 / 30) - 0.4) < 0.01


def test_fixed_alpha_still_works_without_dt():
    s = Smoother(0.5)
    s.update(0.0)
    assert s.update(1.0) == 0.5


# ---- face / hand dropouts ----------------------------------------------------
def test_hold_bridges_a_short_dropout():
    h = Hold(0.4)
    assert h.update("face", 0.0) == "face"
    assert h.update(None, 0.1) == "face"
    assert h.update(None, 0.4) == "face"


def test_hold_gives_up_after_the_timeout_and_does_not_come_back():
    h = Hold(0.4)
    h.update("face", 0.0)
    assert h.update(None, 0.5) is None
    assert h.update(None, 0.6) is None


def test_hold_with_nothing_ever_seen_is_none():
    assert Hold(0.4).update(None, 0.0) is None


def test_hold_updates_to_the_newest_value():
    h = Hold(0.4)
    h.update("a", 0.0)
    h.update("b", 0.1)
    assert h.update(None, 0.2) == "b"


# ---- camera failures ---------------------------------------------------------
class FakeCap:
    def __init__(self, results, opened=True):
        self.results = list(results)
        self.opened = opened
        self.released = False

    def read(self):
        return self.results.pop(0) if self.results else (False, None)

    def isOpened(self):
        return self.opened

    def set(self, *a):
        pass

    def release(self):
        self.released = True


def test_read_frame_survives_a_few_bad_reads():
    frame = np.zeros((2, 2, 3), np.uint8)
    cap = FakeCap([(False, None), (False, None), (True, frame)])
    assert read_frame(cap, sleep=lambda s: None) is frame


def test_read_frame_raises_a_clear_error_when_the_camera_dies():
    with pytest.raises(CameraError):
        read_frame(FakeCap([]), max_failures=5, sleep=lambda s: None)


def test_none_frame_counts_as_a_failure():
    with pytest.raises(CameraError):
        read_frame(FakeCap([(True, None)] * 5), max_failures=5, sleep=lambda s: None)


def test_open_camera_failure_raises_and_releases():
    cap = FakeCap([], opened=False)

    class FakeCv2:
        CAP_PROP_FRAME_WIDTH, CAP_PROP_FRAME_HEIGHT = 3, 4
        VideoCapture = staticmethod(lambda index: cap)

    with pytest.raises(CameraError) as e:
        open_camera(0, 640, 480, cv2_module=FakeCv2)
    assert cap.released and "permission" in str(e.value).lower()


def test_cleanup_runs_when_the_loop_raises():
    from contextlib import ExitStack
    log = []
    with pytest.raises(CameraError):
        with ExitStack() as stack:
            stack.callback(log.append, "camera released")
            stack.callback(log.append, "audio stopped")
            read_frame(FakeCap([]), max_failures=2, sleep=lambda s: None)
    assert log == ["audio stopped", "camera released"]
