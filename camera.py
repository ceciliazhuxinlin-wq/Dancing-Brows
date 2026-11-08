"""Camera open/read with clear errors, so failures do not crash with a traceback."""
from __future__ import annotations

import time


class CameraError(RuntimeError):
    pass


def open_camera(index: int, width: int, height: int, cv2_module=None):
    cv2 = cv2_module
    if cv2 is None:
        import cv2
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        cap.release()
        raise CameraError(f"Could not open camera {index}. Check macOS camera permission "
                          "(System Settings > Privacy & Security > Camera) or try --camera 1.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def read_frame(cap, max_failures: int = 30, sleep=time.sleep):
    """Return the next frame. Tolerates short hiccups (up to max_failures bad reads in a row)."""
    for _ in range(max_failures):
        ok, frame = cap.read()
        if ok and frame is not None:
            return frame
        sleep(0.01)
    raise CameraError("The camera stopped delivering frames (unplugged, or used by another app?).")
