import * as THREE from 'three';

const AXES = ['y', 'z', 'y', 'z', 'y', 'z', 'y'].map(k => new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0));
export const OFFSETS = [0.10, 0.04, 0.42, 0.04, 0.40, 0.04, 0.06];
export const HOME = [-0.24, 0.60, 0, 1.55, 0, 0.99, 0];
const DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

function solveLinear(a, b) {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < b.length; i++) {
    let p = i;
    for (let j = i + 1; j < b.length; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    [m[i], m[p]] = [m[p], m[i]];
    const pivot = m[i][i];
    if (Math.abs(pivot) < 1e-12) return Array(b.length).fill(0);
    for (let k = i; k <= b.length; k++) m[i][k] /= pivot;
    for (let j = 0; j < b.length; j++) if (j !== i) {
      const v = m[j][i];
      for (let k = i; k <= b.length; k++) m[j][k] -= v * m[i][k];
    }
  }
  return m.map(row => row[b.length]);
}

export class ArmKinematics {
  constructor() { this.angles = [...HOME]; this.forward(); }
  forward() {
    const position = new THREE.Vector3(0, 0.055, -0.24);
    const rotation = new THREE.Quaternion();
    this.joints = [];
    for (let i = 0; i < 7; i++) {
      position.add(new THREE.Vector3(0, OFFSETS[i], 0).applyQuaternion(rotation));
      const axis = AXES[i].clone().applyQuaternion(rotation);
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(AXES[i], this.angles[i]));
      this.joints.push({ position: position.clone(), axis, rotation: rotation.clone() });
    }
    this.tip = position.clone().add(new THREE.Vector3(0, 0.14, 0).applyQuaternion(rotation));
    this.rotation = rotation.clone();
    return this.tip;
  }
  solve(target, iterations = 18) {
    const goal = new THREE.Vector3(...target);
    // Seed the redundant chain on its elbow-up branch. A free numerical solve
    // can flip the elbow below the tabletop when crossing between trays.
    // The two axial roll joints are neutral for this downward-grasp task.
    const dx = goal.x, dz = goal.z + 0.24;
    const radius = Math.hypot(dx, dz);
    const height = goal.y + OFFSETS[6] + 0.14 - (0.055 + OFFSETS[0] + OFFSETS[1]);
    const upper = OFFSETS[2] + OFFSETS[3], forearm = OFFSETS[4] + OFFSETS[5];
    const distance = Math.hypot(radius, height);
    if (distance > Math.abs(upper - forearm) && distance < upper + forearm) {
      const yaw = radius > 1e-6 ? Math.atan2(dz, -dx) : this.angles[0];
      const shoulder = Math.atan2(radius, height) - Math.acos(THREE.MathUtils.clamp((upper * upper + distance * distance - forearm * forearm) / (2 * upper * distance), -1, 1));
      const elbow = Math.acos(THREE.MathUtils.clamp((distance * distance - upper * upper - forearm * forearm) / (2 * upper * forearm), -1, 1));
      this.angles = [yaw, shoulder, 0, elbow, 0, Math.PI - shoulder - elbow, yaw];
    }
    for (let n = 0; n < iterations; n++) {
      this.forward();
      const delta = goal.clone().sub(this.tip);
      const q = DOWN.clone().multiply(this.rotation.clone().invert());
      if (q.w < 0) { q.x *= -1; q.y *= -1; q.z *= -1; q.w *= -1; }
      const orientation = new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(2 * 0.28);
      if (delta.length() < 0.0003 && orientation.length() < 0.003) break;
      const error = [...delta.toArray(), ...orientation.toArray()];
      const columns = this.joints.map(j => [...j.axis.clone().cross(this.tip.clone().sub(j.position)).toArray(), ...j.axis.clone().multiplyScalar(0.28).toArray()]);
      const a = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => columns.reduce((sum, col) => sum + col[r] * col[c], r === c ? 0.001 : 0)));
      const v = solveLinear(a, error);
      for (let i = 0; i < 7; i++) {
        const step = columns[i].reduce((sum, item, k) => sum + item * v[k], 0);
        const next = this.angles[i] + THREE.MathUtils.clamp(step, -0.12, 0.12);
        this.angles[i] = Math.atan2(Math.sin(next), Math.cos(next));
      }
    }
    this.forward();
    return this.tip.distanceTo(goal);
  }
  get orientationError() { return this.rotation.angleTo(DOWN); }
}
