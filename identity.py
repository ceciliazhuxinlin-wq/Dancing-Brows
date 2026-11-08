"""Keep each hand glued to the same 'slot' (slot 0 = left brow, slot 1 = right brow).

Old behaviour: hands were re-sorted by screen x every frame, so crossing your
hands swapped the brows. Now each detection is matched to the slot whose
(predicted) position it is closest to, so identity follows the hand.

Pure numpy, no MediaPipe, so it is unit tested.
Limit: if two hands truly overlap, nothing can tell them apart; identity is
then a best guess from motion.
"""
from __future__ import annotations

import numpy as np


class SlotAssigner:
    def __init__(self, n_slots: int = 2, max_missed: int = 8):
        self.n = n_slots
        self.max_missed = max_missed          # frames a slot is remembered without a detection
        self.pos = [None] * n_slots
        self.vel = [np.zeros(2) for _ in range(n_slots)]
        self.missed = [0] * n_slots

    def _predicted(self, j):
        return self.pos[j] + (self.vel[j] if self.missed[j] == 0 else 0)

    def update(self, points, max_jump: float):
        """points: list of (x, y) hand positions. Returns a slot index (or None) per point."""
        pts = [np.asarray(p, float) for p in points]
        n = len(pts)
        assign = [None] * n
        used = set()

        # 1) match detections to remembered slots, closest (predicted) first
        pairs = sorted((float(np.linalg.norm(pts[i] - self._predicted(j))), i, j)
                       for i in range(n) for j in range(self.n) if self.pos[j] is not None)
        for d, i, j in pairs:
            if d > max_jump:
                break
            if assign[i] is None and j not in used:
                assign[i] = j
                used.add(j)

        # 2) unmatched detections take a free slot (else the stalest one)
        newcomers = set()
        free = [j for j in range(self.n) if j not in used and self.pos[j] is None]
        spare = sorted((j for j in range(self.n) if j not in used and self.pos[j] is not None),
                       key=lambda j: -self.missed[j])
        for i in sorted((i for i in range(n) if assign[i] is None), key=lambda i: pts[i][0]):
            j = free.pop(0) if free else (spare.pop(0) if spare else None)
            if j is None:
                break
            assign[i] = j
            used.add(j)
            newcomers.add(i)
            self.pos[j], self.vel[j], self.missed[j] = None, np.zeros(2), 0   # fresh track

        # 3) when a second hand just appeared, make slot order match screen order once
        if newcomers and self.n == 2 and len([a for a in assign if a is not None]) == 2:
            i0, i1 = assign.index(0), assign.index(1)
            if pts[i0][0] > pts[i1][0]:
                assign[i0], assign[i1] = 1, 0
                self.pos[0], self.pos[1] = self.pos[1], self.pos[0]
                self.vel[0], self.vel[1] = self.vel[1], self.vel[0]
                self.missed[0], self.missed[1] = self.missed[1], self.missed[0]

        # 4) update memory
        got = {a: i for i, a in enumerate(assign) if a is not None}
        for j in range(self.n):
            if j in got:
                p = pts[got[j]]
                if self.pos[j] is not None and self.missed[j] == 0:
                    self.vel[j] = 0.5 * self.vel[j] + 0.5 * (p - self.pos[j])
                self.pos[j], self.missed[j] = p, 0
            else:
                self.missed[j] += 1
                if self.missed[j] > self.max_missed:
                    self.pos[j], self.vel[j] = None, np.zeros(2)
        return assign
