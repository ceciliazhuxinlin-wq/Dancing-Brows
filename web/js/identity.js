// Keeps each hand on its own slot (0 = left brow, 1 = right brow) by continuity, not screen x.
// Port of identity.py. Two hands that overlap almost exactly cannot be told apart.
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export class SlotAssigner {
  constructor(nSlots = 2, maxMissed = 8) {
    this.n = nSlots; this.maxMissed = maxMissed;
    this.pos = Array(nSlots).fill(null);
    this.vel = Array.from({ length: nSlots }, () => [0, 0]);
    this.missed = Array(nSlots).fill(0);
  }
  _pred(j) {
    const p = this.pos[j], v = this.missed[j] === 0 ? this.vel[j] : [0, 0];
    return [p[0] + v[0], p[1] + v[1]];
  }
  /** points: [[x,y],...] -> slot index (or null) per point. */
  update(points, maxJump) {
    const n = points.length, assign = Array(n).fill(null), used = new Set();
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < this.n; j++)
      if (this.pos[j] !== null) pairs.push([d2(points[i], this._pred(j)), i, j]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [d, i, j] of pairs) {
      if (d > maxJump) break;
      if (assign[i] === null && !used.has(j)) { assign[i] = j; used.add(j); }
    }
    let newcomers = 0;
    const free = [], spare = [];
    for (let j = 0; j < this.n; j++) if (!used.has(j) && this.pos[j] === null) free.push(j);
    for (let j = 0; j < this.n; j++) if (!used.has(j) && this.pos[j] !== null) spare.push(j);
    spare.sort((a, b) => this.missed[b] - this.missed[a]);
    const unmatched = [...assign.keys()].filter((i) => assign[i] === null).sort((a, b) => points[a][0] - points[b][0]);
    for (const i of unmatched) {
      const j = free.length ? free.shift() : spare.length ? spare.shift() : null;
      if (j === null) break;
      assign[i] = j; used.add(j); newcomers++;
      this.pos[j] = null; this.vel[j] = [0, 0]; this.missed[j] = 0;
    }
    if (newcomers && this.n === 2 && assign.filter((a) => a !== null).length === 2) {
      const i0 = assign.indexOf(0), i1 = assign.indexOf(1);
      if (points[i0][0] > points[i1][0]) {          // second hand just appeared: match screen order once
        assign[i0] = 1; assign[i1] = 0;
        [this.pos[0], this.pos[1]] = [this.pos[1], this.pos[0]];
        [this.vel[0], this.vel[1]] = [this.vel[1], this.vel[0]];
        [this.missed[0], this.missed[1]] = [this.missed[1], this.missed[0]];
      }
    }
    for (let j = 0; j < this.n; j++) {
      const i = assign.indexOf(j);
      if (i !== -1) {
        const p = points[i];
        if (this.pos[j] !== null && this.missed[j] === 0)
          this.vel[j] = [0.5 * this.vel[j][0] + 0.5 * (p[0] - this.pos[j][0]), 0.5 * this.vel[j][1] + 0.5 * (p[1] - this.pos[j][1])];
        this.pos[j] = p; this.missed[j] = 0;
      } else if (++this.missed[j] > this.maxMissed) { this.pos[j] = null; this.vel[j] = [0, 0]; }
    }
    return assign;
  }
}
