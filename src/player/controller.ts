import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics';
import type { Assets } from '../core/assets';

const CAPSULE_HALF = 0.62;   // half height of the cylindrical part
const CAPSULE_R = 0.36;
const EYE = 1.62;
const WALK = 3.4;
const SPRINT = 7.1;
const JUMP = 5.4;
const GRAVITY = -19.0;

/** Primitive mannequin - no rig, animated by moving parts directly. */
function buildMannequin(assets: Assets): { root: THREE.Group; parts: Record<string, THREE.Object3D> } {
  const root = new THREE.Group();
  const skin = assets.plain(0xc8a07e, 0.75);
  const cloth = assets.plain(0x3f4a5c, 0.85);
  const dark = assets.plain(0x2b313c, 0.8);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 4, 8), cloth);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), skin);
  head.position.y = 1.56;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.162, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), dark);
  hair.position.y = 1.575;

  const mkLimb = (len: number, r: number, mat: THREE.Material) =>
    new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 6), mat);

  const armL = mkLimb(0.34, 0.068, skin); armL.position.set(-0.29, 1.16, 0);
  const armR = mkLimb(0.34, 0.068, skin); armR.position.set(0.29, 1.16, 0);
  const legL = mkLimb(0.42, 0.085, dark); legL.position.set(-0.11, 0.52, 0);
  const legR = mkLimb(0.42, 0.085, dark); legR.position.set(0.11, 0.52, 0);

  for (const o of [torso, head, hair, armL, armR, legL, legR]) {
    (o as THREE.Mesh).castShadow = true;
    root.add(o);
  }
  return { root, parts: { torso, head, hair, armL, armR, legL, legR } };
}

export interface Input {
  f: boolean; b: boolean; l: boolean; r: boolean;
  sprint: boolean; jump: boolean;
}

export class Player {
  readonly object: THREE.Group;
  private parts: Record<string, THREE.Object3D>;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;

  private vy = 0;
  private grounded = false;
  private gravityOn = false;     // enabled after the first physics step (failure mode #7)
  private bob = 0;
  private facing = 0;

  /** Camera orbit state (GTA-style: yaw/pitch around the player). */
  yaw = Math.PI;
  pitch = 0.22;
  private armLen = 5.4;
  private armCur = 5.4;
  firstPerson = false;

  private ray = new THREE.Raycaster();
  private tmp = new THREE.Vector3();

  constructor(
    private physics: Physics,
    assets: Assets,
    spawn: THREE.Vector3,
  ) {
    const mann = buildMannequin(assets);
    this.object = mann.root;
    this.parts = mann.parts;
    this.object.position.copy(spawn);

    const R = physics.R;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_R),
      this.body,
    );

    this.ctrl = physics.world.createCharacterController(0.02);
    this.ctrl.enableAutostep(0.45, 0.25, true);   // stairs, kerbs, terrace risers
    this.ctrl.enableSnapToGround(0.6);            // stops bouncing down the slope
    this.ctrl.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((42 * Math.PI) / 180);
    this.ctrl.setApplyImpulsesToDynamicBodies(false);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Called once after the first world.step() so the player cannot fall through. */
  enableGravity() { this.gravityOn = true; }

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera, colliders: THREE.Object3D[]) {
    // --- desired horizontal movement, relative to camera yaw ---
    const speed = input.sprint ? SPRINT : WALK;
    let ix = 0, iz = 0;
    if (input.f) iz -= 1;
    if (input.b) iz += 1;
    if (input.l) ix -= 1;
    if (input.r) ix += 1;
    const moving = ix !== 0 || iz !== 0;
    if (moving) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
    }
    // Rotate input into world space by camera yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ix * cos - iz * sin;
    const wz = ix * sin + iz * cos;

    // --- vertical ---
    if (this.gravityOn) {
      this.vy += GRAVITY * dt;
      if (this.grounded && this.vy < 0) this.vy = -0.5;
      if (input.jump && this.grounded) { this.vy = JUMP; this.grounded = false; }
    } else {
      this.vy = 0;
    }

    const desired = {
      x: wx * speed * dt,
      y: this.vy * dt,
      z: wz * speed * dt,
    };

    this.ctrl.computeColliderMovement(this.collider, desired);
    const mv = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;

    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);

    // --- visual root follows the capsule ---
    this.object.position.set(next.x, next.y - (CAPSULE_HALF + CAPSULE_R), next.z);

    // Face the direction of travel, smoothly.
    if (moving) {
      const target = Math.atan2(wx, wz);
      let d = target - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * Math.min(1, dt * 12);
      this.object.rotation.y = this.facing;
    }

    // --- idle bob / walk sway, driven procedurally ---
    this.bob += dt * (moving ? (input.sprint ? 14 : 9) : 2.2);
    const amp = moving ? (input.sprint ? 0.5 : 0.34) : 0.055;
    const s = Math.sin(this.bob);
    this.parts.legL.rotation.x = s * amp;
    this.parts.legR.rotation.x = -s * amp;
    this.parts.armL.rotation.x = -s * amp * 0.85;
    this.parts.armR.rotation.x = s * amp * 0.85;
    this.parts.torso.position.y = 1.12 + Math.abs(s) * (moving ? 0.035 : 0.008);
    this.parts.head.position.y = 1.56 + Math.abs(s) * (moving ? 0.03 : 0.007);
    this.parts.hair.position.y = 1.575 + Math.abs(s) * (moving ? 0.03 : 0.007);

    this.updateCamera(dt, camera, colliders);
  }

  private updateCamera(dt: number, camera: THREE.PerspectiveCamera, colliders: THREE.Object3D[]) {
    const p = this.position;
    const pivot = this.tmp.set(p.x, p.y + 0.45, p.z);

    if (this.firstPerson) {
      camera.position.set(p.x, p.y + EYE - (CAPSULE_HALF + CAPSULE_R) + 0.55, p.z);
      const dir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        -Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      camera.lookAt(camera.position.clone().add(dir));
      this.object.visible = false;
      return;
    }
    this.object.visible = true;

    // Spring arm direction (behind the player).
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();

    // Failure mode #6: raycast pivot -> desired camera spot, pull in on any hit.
    let allowed = this.armLen;
    this.ray.set(pivot, dir);
    this.ray.far = this.armLen + 0.4;
    const hits = this.ray.intersectObjects(colliders, true);
    for (const h of hits) {
      if (h.distance < allowed) allowed = Math.max(1.1, h.distance - 0.35);
      break;
    }
    // Smooth the arm so corners do not snap.
    this.armCur += (allowed - this.armCur) * Math.min(1, dt * (allowed < this.armCur ? 18 : 6));

    camera.position.copy(pivot).addScaledVector(dir, this.armCur);
    camera.lookAt(pivot.x, pivot.y + 0.25, pivot.z);
  }

  toggleView() { this.firstPerson = !this.firstPerson; }

  teleport(to: THREE.Vector3) {
    this.body.setTranslation({ x: to.x, y: to.y, z: to.z }, true);
    this.vy = 0;
  }
}
