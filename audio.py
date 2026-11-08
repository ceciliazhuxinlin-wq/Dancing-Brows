"""Brow height -> a soft, low, music-box-like note.

Notes are snapped to a C major pentatonic scale (C D E G A), so any hand
position sounds pleasant. Each new note gets a small 'pluck' that fades to a
quiet sustain. sounddevice is imported lazily so the rest of the project (and
the tests) work without an audio device.
"""
from __future__ import annotations

import numpy as np

F_LOW = 130.81    # C3
F_HIGH = 523.25   # C5 (two octaves up)
_PENTATONIC = (0, 2, 4, 7, 9)
_LOW_MIDI = 48    # C3
_HARMONICS = (1.0, 0.25, 0.08)   # mostly sine + a little 2nd/3rd harmonic = soft bell
AMPLITUDE = 0.12
SUSTAIN = 0.35    # level the pluck settles to (1.0 = start of pluck)
PLUCK_TAU = 0.25  # seconds for the pluck to fade


def height_to_freq(t: float, f_low: float = F_LOW, f_high: float = F_HIGH) -> float:
    """t in 0..1 -> frequency, exponential so equal steps sound like equal intervals."""
    t = min(1.0, max(0.0, t))
    return f_low * (f_high / f_low) ** t


def scale_freqs() -> list:
    """C3 .. C5 pentatonic notes in Hz (11 notes)."""
    midi = [_LOW_MIDI + 12 * o + s for o in range(2) for s in _PENTATONIC] + [_LOW_MIDI + 24]
    return [440.0 * 2 ** ((m - 69) / 12) for m in midi]


class NoteSnapper:
    """Snap t in 0..1 to the nearest scale note, with hysteresis so the note
    does not flutter when t sits on the border between two notes."""

    def __init__(self, hysteresis: float = 0.65):
        self.notes = scale_freqs()
        self.hys = hysteresis
        self.idx = None

    def freq(self, t: float) -> float:
        x = min(1.0, max(0.0, t)) * (len(self.notes) - 1)
        if self.idx is None or abs(x - self.idx) > self.hys:
            self.idx = int(round(x))
        return self.notes[self.idx]


class Synth:
    def __init__(self, sample_rate: int = 44100, enabled: bool = True):
        self.sr = sample_rate
        self.enabled = enabled
        self.available = False
        self._stream = None
        self._f = F_LOW
        self._amp = 0.0
        self._f_target = F_LOW
        self._amp_target = 0.0
        self._phase = 0.0
        self._env = 0.0          # pluck envelope, 1 -> 0

    def start(self) -> None:
        if not self.enabled:
            return
        try:
            import sounddevice as sd
            self._stream = sd.OutputStream(samplerate=self.sr, channels=1,
                                           callback=self._callback, blocksize=512)
            self._stream.start()
            self.available = True
        except Exception as e:  # no device, missing PortAudio, ...
            print(f"[audio] disabled: {e}")

    def set(self, freq: float, amp: float) -> None:
        if amp > 0 and abs(freq - self._f_target) > 0.01 * self._f_target:
            self._env = 1.0      # new note -> little pluck
        self._f_target = float(freq)
        self._amp_target = float(amp)

    def _callback(self, outdata, frames, time, status):
        # Ramp frequency and volume across the block: a tiny glide between notes, no clicks.
        f_end = self._f + 0.5 * (self._f_target - self._f)
        a_end = self._amp + 0.3 * (self._amp_target - self._amp)
        freqs = np.linspace(self._f, f_end, frames)
        amps = np.linspace(self._amp, a_end, frames)
        env0 = self._env
        env1 = env0 * np.exp(-frames / (self.sr * PLUCK_TAU))
        env = np.linspace(env0, env1, frames)
        level = SUSTAIN + (1 - SUSTAIN) * env
        phase = self._phase + np.cumsum(2 * np.pi * freqs / self.sr)
        wave = sum(w * np.sin((k + 1) * phase) for k, w in enumerate(_HARMONICS)) / sum(_HARMONICS)
        outdata[:, 0] = (amps * level * wave).astype(np.float32)
        self._phase = float(phase[-1] % (2 * np.pi))
        self._f, self._amp, self._env = f_end, a_end, float(env1)

    def stop(self) -> None:
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception as e:
                print(f"[audio] error while stopping: {e}")

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()
