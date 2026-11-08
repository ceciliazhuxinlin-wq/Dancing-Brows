import test from "node:test";
import assert from "node:assert/strict";
import { SlotAssigner } from "../js/identity.js";
const G = 256;

test("first two hands take slots by screen order, whatever the detection order", () => {
  assert.deepEqual(new SlotAssigner().update([[500, 200], [100, 200]], G), [1, 0]);
});
test("crossing hands keep their identity", () => {
  const a = new SlotAssigner(); a.update([[100, 200], [500, 240]], G);
  for (let s = 1; s <= 20; s++) {
    const out = a.update([[500 - 20 * s, 240], [100 + 20 * s, 200]], G);   // shuffled order
    assert.equal(out[1], 0, `swapped at step ${s}`); assert.equal(out[0], 1);
  }
  assert.ok(a.pos[0][0] > a.pos[1][0]);
});
test("a short dropout keeps identity, a long one frees the slot", () => {
  let a = new SlotAssigner(2, 8); a.update([[100, 200], [500, 200]], G);
  for (let i = 0; i < 5; i++) a.update([[500, 200]], G);
  assert.deepEqual(a.update([[105, 200], [500, 200]], G), [0, 1]);
  a = new SlotAssigner(2, 3); a.update([[100, 200], [500, 200]], G);
  for (let i = 0; i < 5; i++) a.update([[500, 200]], G);
  assert.equal(a.pos[0], null); assert.notEqual(a.pos[1], null);
});
test("a second hand appearing on the left gets slot 0", () => {
  const a = new SlotAssigner(); assert.deepEqual(a.update([[500, 200]], G), [0]);
  assert.deepEqual(a.update([[500, 200], [100, 200]], G), [1, 0]);
});
test("exact overlap and extra detections never break the one-per-slot rule", () => {
  let a = new SlotAssigner(); a.update([[100, 200], [500, 200]], G);
  assert.deepEqual(a.update([[300, 200], [300, 200]], G).sort(), [0, 1]);
  a = new SlotAssigner();
  assert.deepEqual(a.update([[50, 0], [300, 0], [600, 0]], G).filter((x) => x !== null).sort(), [0, 1]);
  assert.deepEqual(a.update([], G), []);
});
