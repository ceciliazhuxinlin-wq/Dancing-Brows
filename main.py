"""Brow Instrument: hands drive cartoon eyebrows, brow height plays a note.

Keys: q/Esc quit | s next brow style | b capture my own brows | e erase real brows
      m mute | d hand debug | c calibrate neutral brow
"""
from __future__ import annotations

import argparse
import time
from contextlib import ExitStack
from dataclasses import replace

import cv2
import numpy as np

from audio import AMPLITUDE, NoteSnapper, Synth
from brow import (DEFAULT_SPACING, Hold, Smoother, brow_params, layout_specs,
                  normalise, spacing_from_hands)
from camera import CameraError, open_camera, read_frame
from render import (STYLES, capture_brow_sprites, draw_brow_styled, draw_hand_debug,
                    draw_hud, draw_sprite, erase_brows)
from tracking import Tracker

# Time constants (seconds). tau = -dt / ln(1 - alpha): these match the old fixed
# alphas (0.4 / 0.3 / 0.05 / 0.1) at 30 FPS, but now behave the same at any FPS.
TAU_HAND, TAU_DIST, TAU_NATURAL, TAU_FPS = 0.065, 0.093, 0.65, 0.32
FACE_HOLD_S = 0.4     # keep the last face this long after a dropout, then hide the brows
HAND_HOLD_S = 0.3     # same for each hand


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--erase", action="store_true", help="start with real brows erased")
    ap.add_argument("--sound-source", choices=["cartoon", "real"], default="cartoon",
                    help="what drives pitch: the hand-controlled cartoon brow or your real brow")
    return ap.parse_args()


def run(args):
    # ExitStack guarantees camera, tracker, audio and window are released
    # (in reverse order) even if something below raises.
    with ExitStack() as stack:
        cap = open_camera(args.camera, args.width, args.height)
        stack.callback(cap.release)
        tracker = stack.enter_context(Tracker())
        synth = stack.enter_context(Synth(enabled=not args.no_audio))
        stack.callback(cv2.destroyAllWindows)
        loop(args, cap, tracker, synth)


def loop(args, cap, tracker, synth):
    hand_sm = [Smoother(tau=TAU_HAND), Smoother(tau=TAU_HAND)]       # pinch, per slot
    tilt_sm = [Smoother(tau=TAU_HAND), Smoother(tau=TAU_HAND)]
    dist_sm, real_sm = Smoother(tau=TAU_DIST), Smoother(tau=TAU_DIST)
    natural_sm, yaw_sm, fps_sm = Smoother(tau=TAU_NATURAL), Smoother(tau=TAU_DIST), Smoother(tau=TAU_FPS)
    face_hold = Hold(FACE_HOLD_S)
    hand_hold = [Hold(HAND_HOLD_S), Hold(HAND_HOLD_S)]               # (params, centre) per slot
    snapper = NoteSnapper()
    neutral = None
    erase, muted, debug = args.erase, False, True
    style_i, sprites, want_capture = 0, None, False
    last = time.perf_counter()

    while True:
        frame = read_frame(cap)                  # raises CameraError if the camera dies
        frame = cv2.flip(frame, 1)               # mirror, like a selfie camera
        now = time.perf_counter()
        dt = min(max(now - last, 1 / 240), 0.25)
        last = now
        fps = fps_sm.update(1.0 / dt, dt)

        res = tracker.process(frame)
        face = face_hold.update(res.face, now)   # last good face for a short while, else None

        # Capture / erase only use a FRESH detection (a held face may be slightly stale)
        if want_capture and res.face:            # must happen BEFORE erasing
            sprites = capture_brow_sprites(frame, res.face)
            style_i, erase, want_capture = STYLES.index("own"), True, False
        if erase and res.face:
            frame = erase_brows(frame, res.face)

        natural, yaw, real_h = DEFAULT_SPACING, 0.0, None
        if face:
            natural = natural_sm.update((face.brows[1].cx - face.brows[0].cx) / face.face_w, dt)
            yaw = yaw_sm.update(face.yaw_deg, dt)
            real_h = real_sm.update(float(np.mean([b.height for b in face.brows])), dt)

        # Hands -> brow parameters, remembered per slot for a moment (one dropped frame won't flicker)
        seen = {hd.slot: hd for hd in res.hands}
        held = []
        for slot in (0, 1):
            hd = seen.get(slot)
            item = None
            if hd is not None:
                item = (brow_params(hand_sm[slot].update(hd.pinch, dt), tilt_sm[slot].update(hd.tilt_deg, dt)),
                        hd.center)
            held.append(hand_hold[slot].update(item, now))
        active = [x for x in held if x is not None]

        # Cartoon brows: only when a face is known. No face -> nothing is drawn (no guessed position).
        t_cartoon = None
        if face and active:
            params = [p for p, _ in active]
            if len(params) == 1:                 # one hand drives both brows (mirrored tilt)
                params.append(replace(params[0], tilt_deg=-params[0].tilt_deg))
                spacing = natural
            else:
                dist = float(np.linalg.norm(active[0][1] - active[1][1]))
                spacing = spacing_from_hands(dist_sm.update(dist, dt), face.face_w, natural)
            thickness = max(3, int(face.face_h * 0.035))
            style = STYLES[style_i]
            specs = layout_specs(params, face.anchor_x, face.eye_y, face.face_w, face.face_h, spacing, yaw)
            for slot, spec in enumerate(specs):
                if style == "own" and sprites:
                    draw_sprite(frame, sprites[slot], spec)
                else:
                    draw_brow_styled(frame, spec.points(), "classic" if style == "own" else style,
                                     max(2, int(thickness * spec.depth)), inner_at_end=(slot == 0))
            t_cartoon = float(np.mean([p.t for p in params]))
        if debug:
            for hd in res.hands:
                draw_hand_debug(frame, hd)

        t_real = None
        if real_h is not None and neutral:
            t_real = normalise(real_h / neutral, 0.8, 1.5)   # relative to your calibrated neutral

        # Sound (silent if nothing drives it)
        t_sound = t_cartoon if args.sound_source == "cartoon" else t_real
        freq = snapper.freq(t_sound) if t_sound is not None else None
        synth.set(freq or 220.0, 0.0 if (freq is None or muted) else AMPLITUDE)

        # HUD
        if not face:
            status = "face lost: look at the camera"
        else:
            status = f"real brow height {real_h:.3f}   head turn {yaw:+.0f} deg"
        if freq:
            note_line = f"note {freq:.0f} Hz ({args.sound_source})"
        elif args.sound_source == "cartoon":
            note_line = "silent (show a hand)" if face else "silent"
        else:
            note_line = "silent (press c to calibrate)"
        draw_hud(frame, [
            f"loop FPS {fps:.1f}",
            status,
            note_line,
            f"style: {STYLES[style_i]}" + ("  (press b to capture)" if STYLES[style_i] == "own" and not sprites else ""),
            "s style  b my brow  e erase  m mute  d debug  c calib  q quit",
        ])
        cv2.imshow("Brow Instrument", frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("s"):
            style_i = (style_i + 1) % len(STYLES)
        elif key == ord("b"):
            want_capture = True
        elif key == ord("e"):
            erase = not erase
        elif key == ord("m"):
            muted = not muted
        elif key == ord("d"):
            debug = not debug
        elif key == ord("c") and real_h is not None:
            neutral = real_h


def main():
    try:
        run(parse_args())
    except CameraError as e:
        raise SystemExit(f"Camera problem: {e}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
