import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BINS, COLORS } from './world.js';
import { ArmKinematics } from './kinematics.js';

export class Workcell {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e7ede4');
    this.scene.fog = new THREE.Fog('#e7ede4', 5, 12);
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.01, 30);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.4; this.controls.maxDistance = 5;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0.18, 0.02);
    this.resetCamera();
    this.materials = {};
    this.scene.add(new THREE.HemisphereLight('#fffef3', '#869581', 2));
    const sun = new THREE.DirectionalLight('#fff8e9', 2.8);
    sun.position.set(-2, 5, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 12 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.012; this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#e0f5ee', 1.5); rim.position.set(3, 2, -2); this.scene.add(rim);
    this.buildTable(); this.buildTrays(); this.buildRobot();
    this.arm = new ArmKinematics();
    this.arm.solve([0, 0.48, -0.06], 200);
    this.updateRobot();
    this.objectMeshes = new Map(); this.labels = new Map(); this.trailPoints = [];
    this.trailMaterial = new THREE.LineBasicMaterial({ color: '#7aaa84', transparent: true, opacity: 0.6 });
    this.trail = new THREE.Line(new THREE.BufferGeometry(), this.trailMaterial); this.scene.add(this.trail);
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.058, 0.062, 48), new THREE.MeshBasicMaterial({ color: '#56794b', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    this.targetRing.rotation.x = -Math.PI / 2; this.targetRing.visible = false; this.scene.add(this.targetRing);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize();
  }
  material(color, metalness = 0, roughness = 0.65) {
    const key = `${color}-${metalness}-${roughness}`;
    return this.materials[key] ??= new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }
  box(size, position, color, radius = 0.008, parent = this.scene, metalness = 0) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 3, radius), this.material(color, metalness));
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  cylinder(radius, height, position, color, parent = this.scene, radiusTop = radius) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radius, height, 32), this.material(color, 0.3, 0.4));
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  label(text, width = 0.22, color = '#73816b', background = null) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 100); }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '500 43px -apple-system, sans-serif';
    ctx.fillText(text, 256, 50);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
    sprite.scale.set(width, width * 100 / 512, 1); return sprite;
  }
  buildTable() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), this.material('#e5ece1'));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.55; floor.receiveShadow = true; this.scene.add(floor);
    this.box([1.75, 0.065, 1.38], [0, -0.04, 0.02], '#d7dfd1', 0.035);
    this.box([1.71, 0.018, 1.34], [0, -0.005, 0.02], '#f1f2e8', 0.022);
    for (const x of [-0.73, 0.73]) for (const z of [-0.53, 0.57]) {
      this.box([0.055, 0.45, 0.055], [x, -0.3, z], '#c2cebc');
      this.cylinder(0.009, 0.003, [x, 0.006, z], '#a6b39e');
    }
    const grid = new THREE.GridHelper(1.6, 32, '#d8dfd0', '#e2e7d9'); grid.position.set(0, 0.006, 0.01);
    grid.scale.z = 0.76; grid.material.transparent = true; grid.material.opacity = 0.55; this.scene.add(grid);
    this.box([0.46, 0.007, 0.68], [-0.415, 0.011, 0.06], '#e6eade', 0.018);
    const incoming = this.label('INCOMING PARTS', 0.27); incoming.position.set(-0.42, 0.028, 0.46); this.scene.add(incoming);
    const cellLabel = this.label('OPENARM   /   CELL 001', 0.39, '#768b6a'); cellLabel.position.set(-0.48, -0.048, 0.725); this.scene.add(cellLabel);
    // Reference coordinates on the work surface.
    const axisOrigin = new THREE.Vector3(-0.73, 0.02, 0.49);
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), axisOrigin, 0.09, '#d19077', 0.015, 0.009));
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), axisOrigin, 0.09, '#85a8a5', 0.015, 0.009));
  }
  buildTrays() {
    this.trayMeshes = new Map();
    for (const bin of BINS) {
      const group = new THREE.Group(); group.position.set(...bin.position); this.scene.add(group);
      this.box([0.265, 0.018, 0.22], [0, 0.016, 0], bin.color, 0.012, group);
      this.box([0.245, 0.005, 0.20], [0, 0.028, 0], '#edf0e5', 0.008, group);
      for (const z of [-0.107, 0.107]) this.box([0.265, 0.043, 0.014], [0, 0.033, z], bin.color, 0.005, group);
      for (const x of [-0.126, 0.126]) this.box([0.014, 0.043, 0.22], [x, 0.033, 0], bin.color, 0.005, group);
      const label = this.label(bin.name.toUpperCase(), 0.17, '#7d8875'); label.position.set(0, 0.085, 0.16); group.add(label);
      const block = this.box([0.20, 0.008, 0.14], [0, 0.075, 0], '#db8c78', 0.01, group);
      const stopLabel = this.label('BLOCKED', 0.16, '#fff3e6'); stopLabel.position.set(0, 0.115, 0); block.add(stopLabel); stopLabel.position.set(0, 0.01, 0); block.visible = false;
      this.trayMeshes.set(bin.id, { group, block });
    }
  }
  buildRobot() {
    this.box([0.19, 0.025, 0.19], [0, 0.026, -0.24], '#677565', 0.016);
    this.cylinder(0.071, 0.085, [0, 0.078, -0.24], '#f4f4e9');
    this.cylinder(0.078, 0.018, [0, 0.045, -0.24], '#38433b');
    this.cylinder(0.073, 0.008, [0, 0.12, -0.24], '#8fa782');
    this.jointGroups = [];
    this.linkMeshes = [];
    for (let i = 0; i < 7; i++) {
      const group = new THREE.Group(); this.scene.add(group); this.jointGroups.push(group);
      const radius = i < 2 ? 0.052 : i < 4 ? 0.045 : 0.033;
      const joint = this.cylinder(radius, radius * 1.1, [0, 0, 0], '#404a40', group);
      if (i % 2 === 1) joint.rotation.x = Math.PI / 2;
      const cap = this.cylinder(radius * 0.83, radius * 1.17, [0, 0, 0], '#d5ded0', group);
      if (i % 2 === 1) cap.rotation.x = Math.PI / 2;
      if (i === 1 || i === 3 || i === 5) {
        const bolt = this.cylinder(0.012, radius * 1.24, [0, 0, 0], '#68785f', group); bolt.rotation.x = Math.PI / 2;
      }
      if (i < 6) {
        const link = this.box([i < 3 ? 0.061 : 0.049, 1, i < 3 ? 0.067 : 0.054], [0, 0, 0], '#f5f4e9', 0.019);
        this.linkMeshes.push(link);
      }
    }
    const wrist = this.jointGroups[6];
    this.box([0.088, 0.04, 0.058], [0, 0.043, 0], '#3d493f', 0.006, wrist);
    this.box([0.079, 0.023, 0.056], [0, 0.06, 0], '#d3dfcc', 0.003, wrist);
    this.fingers = [-1, 1].map(sign => {
      const finger = this.box([0.013, 0.088, 0.044], [sign * 0.047, 0.105, 0], '#68725f', 0.003, wrist);
      this.box([0.006, 0.049, 0.047], [-sign * 0.007, 0.019, 0], '#30392e', 0.002, finger);
      return finger;
    });
    this.gripAmount = 0;
  }
  updateRobot() {
    const joints = this.arm.joints;
    for (let i = 0; i < 7; i++) {
      this.jointGroups[i].position.copy(joints[i].position); this.jointGroups[i].quaternion.copy(joints[i].rotation);
      if (i < 6) {
        const a = joints[i].position, b = joints[i + 1].position, direction = b.clone().sub(a);
        const mesh = this.linkMeshes[i]; mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
        mesh.scale.y = Math.max(0.02, direction.length() - 0.018);
      }
    }
    this.fingers.forEach((f, i) => f.position.x = (i ? 1 : -1) * THREE.MathUtils.lerp(0.047, 0.034, this.gripAmount));
  }
  resetObjects(objects) {
    for (const group of this.objectMeshes.values()) {
      group.traverse(item => {
        if (item.geometry) item.geometry.dispose();
        if (item.isSprite) { item.material.map?.dispose(); item.material.dispose(); }
      });
      this.scene.remove(group);
    }
    this.objectMeshes.clear(); this.labels.clear();
    for (const object of objects) {
      const group = new THREE.Group(); group.position.set(...object.position); this.scene.add(group);
      this.box([0.056, 0.065, 0.056], [0, 0, 0], COLORS[object.color], 0.009, group);
      this.box([0.024, 0.003, 0.024], [0, 0.033, 0], '#ecf0e3', 0.003, group);
      this.box([0.012, 0.004, 0.012], [0, 0.036, 0], COLORS[object.color], 0.002, group);
      if (object.damaged) {
        const mark = this.box([0.005, 0.047, 0.003], [0, 0, 0.029], '#713d30', 0.001, group); mark.rotation.z = -0.7;
        const dot = this.label('!', 0.038, '#f9e8d3', '#b77259'); dot.position.set(0.038, 0.04, 0); group.add(dot);
      }
      const label = this.label(object.id, 0.084, '#849077'); label.position.set(0, 0.085, 0); group.add(label);
      this.objectMeshes.set(object.id, group); this.labels.set(object.id, label);
    }
    this.clearTrail(); this.targetRing.visible = false;
  }
  moveObject(id, position) { this.objectMeshes.get(id)?.position.copy(position); }
  highlight(id) {
    const object = this.objectMeshes.get(id);
    this.targetRing.visible = !!object;
    if (object) this.targetRing.position.set(object.position.x, 0.019, object.position.z);
  }
  blockTray(id, blocked) { this.trayMeshes.get(id).block.visible = blocked; }
  moveTo(target) { const error = this.arm.solve(target); this.updateRobot(); return error; }
  setGrip(amount) { this.gripAmount = amount; this.updateRobot(); }
  addTrail() {
    const last = this.trailPoints.at(-1);
    if (last && last.distanceTo(this.arm.tip) < 0.007) return;
    this.trailPoints.push(this.arm.tip.clone()); if (this.trailPoints.length > 600) this.trailPoints.shift();
    const old = this.trail.geometry; this.trail.geometry = new THREE.BufferGeometry().setFromPoints(this.trailPoints); old.dispose();
  }
  clearTrail() { this.trailPoints = []; const old = this.trail.geometry; this.trail.geometry = new THREE.BufferGeometry(); old.dispose(); }
  resetCamera() { this.camera.position.set(1.55, 1.65, 2.05); this.controls.target.set(0, 0.08, 0.015); this.controls.update(); }
  topCamera() { this.camera.position.set(0.01, 2.95, 0.4); this.controls.target.set(0, 0, 0); this.controls.update(); }
  resize() { const { width, height } = this.container.getBoundingClientRect(); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false); }
  render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
}
