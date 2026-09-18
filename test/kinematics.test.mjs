import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArmKinematics } from '../public/kinematics.js';
import { initialObjects, BINS, destinationPosition } from '../public/world.js';

test('seven-joint IK reaches every pickup and all 24 tray slots with downward tool orientation', () => {
  const arm = new ArmKinematics();
  const points = [[0, 0.48, -0.06], ...initialObjects().map(o => o.position), ...BINS.flatMap(b => Array.from({ length: 6 }, (_, i) => destinationPosition(b.id, i)))];
  for (const target of points) {
    // Follow the same lift/translate/lower path used by the visual controller.
    const waypoints = [[arm.tip.x, 0.32, arm.tip.z], [target[0], 0.32, target[2]], target];
    for (const goal of waypoints) {
      const start = arm.tip.toArray();
      for (let n = 1; n <= 40; n++) arm.solve(start.map((v, i) => v + (goal[i] - v) * n / 40), 18);
      const error = arm.solve(goal, 200);
      assert(error < 0.007, `Position error ${error} at ${goal}`);
      assert(arm.orientationError < 0.10, `Orientation error ${arm.orientationError} at ${goal}`);
      assert(arm.angles.every(a => Number.isFinite(a) && Math.abs(a) <= Math.PI));
    }
  }
});
test('unreachable target remains finite and reports an error instead of claiming success', () => {
  const arm = new ArmKinematics();
  const error = arm.solve([10, 10, 10], 100);
  assert(error > 1); assert(arm.angles.every(Number.isFinite));
});
test('cross-workcell pick-and-place keeps the elbow above the table, including the first live failure path', () => {
  const arm = new ArmKinematics(); arm.solve([0, 0.48, -0.06]);
  const slots = {};
  for (const object of initialObjects()) {
    const bin = object.damaged ? 'inspection' : object.color;
    const destination = destinationPosition(bin, slots[bin] ?? 0); slots[bin] = (slots[bin] ?? 0) + 1;
    const source = object.position;
    for (const goal of [[arm.tip.x, 0.32, arm.tip.z], [source[0], 0.32, source[2]], source, [source[0], 0.32, source[2]], [0, 0.32, 0.27], [destination[0], 0.32, destination[2]], destination]) {
      const start = arm.tip.toArray();
      for (let frame = 1; frame <= 30; frame++) {
        const t = frame / 30, ease = t * t * (3 - 2 * t);
        const target = start.map((v, i) => v + (goal[i] - v) * ease);
        assert(arm.solve(target) < 0.007); assert(arm.orientationError < 0.10);
        assert(arm.joints.every(j => j.position.y > 0.03), 'Joint center penetrated the table');
      }
    }
  }
});
