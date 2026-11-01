import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { TerrainResult } from '../world/terrain';

/**
 * Rapier wrapper.
 *
 * Failure mode #1: the WASM module must be initialised BEFORE any World or
 * ColliderDesc is touched. `Physics.create()` is the only constructor, and it
 * awaits RAPIER.init() first, so no call site can get the order wrong.
 */
export class Physics {
  world!: RAPIER.World;
  private statics: RAPIER.Collider[] = [];

  static async create(): Promise<Physics> {
    await RAPIER.init();              // <-- must happen first
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    p.world.timestep = 1 / 60;
    return p;
  }

  get R() { return RAPIER; }

  /** Terrain heightfield collider, matching the render mesh exactly. */
  addTerrain(t: TerrainResult) {
    const desc = RAPIER.ColliderDesc.heightfield(
      t.nrows, t.ncols, t.heights, t.scale,
    ).setFriction(1.0);
    this.statics.push(this.world.createCollider(desc));
  }

  /** Static box, given centre + half-extents in world space. */
  addBox(centre: THREE.Vector3, half: THREE.Vector3, rotY = 0): RAPIER.Collider {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)),
    );
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.9),
      body,
    );
    this.statics.push(c);
    return c;
  }

  /** Trimesh collider from a THREE geometry already in world space. */
  addTrimesh(geo: THREE.BufferGeometry, at = new THREE.Vector3()): RAPIER.Collider | null {
    const pos = geo.attributes.position;
    if (!pos) return null;
    const verts = new Float32Array(pos.array as Float32Array);
    const index = geo.index
      ? new Uint32Array(geo.index.array as ArrayLike<number>)
      : new Uint32Array(Array.from({ length: pos.count }, (_, i) => i));
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z),
    );
    try {
      const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, index), body);
      this.statics.push(c);
      return c;
    } catch {
      return null; // degenerate geometry - skip rather than crash the world
    }
  }

  step() { this.world.step(); }

  get colliderCount() { return this.statics.length; }
}
