"""Measure tracking speed on your own machine and camera.

Usage:  python benchmark.py --seconds 20
Keep your face AND both hands in view the whole time, otherwise numbers are not
comparable. Paste the printed table into README.md.
"""
from __future__ import annotations

import argparse
import platform
import time

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--erase", action="store_true", help="also time the inpainting step")
    args = ap.parse_args()

    import mediapipe as mp
    from render import erase_brows
    from tracking import Tracker

    from camera import CameraError, open_camera, read_frame
    try:
        cap = open_camera(args.camera, args.width, args.height)
    except CameraError as e:
        raise SystemExit(f"Camera problem: {e}")
    try:
        with Tracker() as tracker:
            measure(args, cap, tracker, mp, erase_brows)
    except CameraError as e:
        raise SystemExit(f"Camera problem: {e}")
    finally:
        cap.release()


def measure(args, cap, tracker, mp, erase_brows):
    from camera import read_frame
    for _ in range(30):                      # warm-up, not counted
        tracker.process(cv2.flip(read_frame(cap), 1))

    frame_ms, track_ms, erase_ms = [], [], []
    face_frames = two_hand_frames = n = 0
    start = time.perf_counter()
    while time.perf_counter() - start < args.seconds:
        t0 = time.perf_counter()
        f = cv2.flip(read_frame(cap), 1)
        t1 = time.perf_counter()
        res = tracker.process(f)
        t2 = time.perf_counter()
        if args.erase and res.face:
            erase_brows(f, res.face)
        t3 = time.perf_counter()
        frame_ms.append((t3 - t0) * 1000)
        track_ms.append((t2 - t1) * 1000)
        erase_ms.append((t3 - t2) * 1000)
        n += 1
        face_frames += res.face is not None
        two_hand_frames += len(res.hands) == 2
    elapsed = time.perf_counter() - start
    real_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    real_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print("\n| Item | Value |\n|---|---|")
    print(f"| Machine | {platform.platform()} / {platform.processor() or platform.machine()} |")
    print(f"| Python / mediapipe / opencv | {platform.python_version()} / {mp.__version__} / {cv2.__version__} |")
    print(f"| Camera resolution (actual) | {real_w}x{real_h} |")
    print(f"| Frames / seconds | {n} / {elapsed:.1f} |")
    print(f"| Pipeline FPS (capture + tracking{' + erase' if args.erase else ''}) | {n / elapsed:.1f} |")
    print(f"| ms per frame, mean / p95 | {np.mean(frame_ms):.1f} / {np.percentile(frame_ms, 95):.1f} |")
    print(f"| Tracking only, mean ms | {np.mean(track_ms):.1f} |")
    if args.erase:
        print(f"| Inpaint only, mean ms | {np.mean(erase_ms):.1f} |")
    print(f"| Frames with a face | {100 * face_frames / n:.0f}% |")
    print(f"| Frames with two hands | {100 * two_hand_frames / n:.0f}% |")


if __name__ == "__main__":
    main()
