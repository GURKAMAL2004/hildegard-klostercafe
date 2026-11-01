import * as THREE from 'three';
import type { Assets } from '../core/assets';
import type { Physics } from '../core/physics';

/**
 * Modular neo-Romanesque kit, matched to the reference photos of Abtei St. Hildegard:
 * reddish sandstone ashlar, round-arched windows, twin west towers, slate roofs.
 *
 * Every piece registers a collider so the player cannot walk through masonry.
 * Geometry is deliberately low-mid poly - round arches use 8-10 segments.
 */
export class Kit {
  /** Collects every mesh so the caller can add one group to the scene. */
  readonly group = new THREE.Group();
  private triCount = 0;

  constructor(private assets: Assets, private physics: Physics | null) {
    this.group.name = 'abbey-kit';
  }

  get triangles() { return this.triCount; }

  private track(geo: THREE.BufferGeometry) {
    const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    this.triCount += n;
  }

  private add(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: THREE.Vector3,
    rotY = 0,
    opts: { collide?: boolean; half?: THREE.Vector3; shadow?: boolean } = {},
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.rotation.y = rotY;
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    this.group.add(m);
    this.track(geo);
    if (opts.collide !== false && opts.half && this.physics) {
      this.physics.addBox(pos, opts.half, rotY);
    }
    return m;
  }

  private sandstone(repeat = 2) {
    return this.assets.material('sandstone', { repeat, roughness: 0.9, color: 0xc89b7d });
  }
  private slate(repeat = 3) {
    return this.assets.material('slate', { repeat, roughness: 0.7, color: 0x6a717a });
  }

  // ---------------------------------------------------------------- walls

  /**
   * Wall segment with optional round-arched window openings.
   * Built as solid blocks around the holes (cheaper and more robust than CSG).
   */
  wall(
    centre: THREE.Vector3,
    w: number,
    h: number,
    t: number,
    rotY = 0,
    windows: { count: number; sillY: number; winW: number; winH: number } | null = null,
    repeat = 2,
  ) {
    const mat = this.sandstone(repeat);
    if (!windows || windows.count <= 0) {
      const g = new THREE.BoxGeometry(w, h, t);
      this.add(g, mat, centre, rotY, { half: new THREE.Vector3(w / 2, h / 2, t / 2) });
      return;
    }

    const { count, sillY, winW, winH } = windows;
    const pitch = w / count;
    const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));

    // Band below the sills.
    const belowH = sillY;
    if (belowH > 0.05) {
      const g = new THREE.BoxGeometry(w, belowH, t);
      const c = centre.clone().setY(centre.y - h / 2 + belowH / 2);
      this.add(g, mat, c, rotY, { half: new THREE.Vector3(w / 2, belowH / 2, t / 2) });
    }
    // Band above the arch tops.
    const topStart = sillY + winH + winW / 2;
    const aboveH = h - topStart;
    if (aboveH > 0.05) {
      const g = new THREE.BoxGeometry(w, aboveH, t);
      const c = centre.clone().setY(centre.y - h / 2 + topStart + aboveH / 2);
      this.add(g, mat, c, rotY, { half: new THREE.Vector3(w / 2, aboveH / 2, t / 2) });
    }
    // Piers between windows + the arch spandrels.
    const pierW = pitch - winW;
    for (let i = 0; i <= count; i++) {
      const off = -w / 2 + i * pitch;
      const pw = i === 0 || i === count ? pierW / 2 + 0.001 : pierW;
      const px = off + (i === 0 ? pw / 2 : i === count ? -pw / 2 : 0);
      const c = centre.clone()
        .addScaledVector(dir, px)
        .setY(centre.y - h / 2 + sillY + (winH + winW / 2) / 2);
      const g = new THREE.BoxGeometry(pw, winH + winW / 2, t);
      this.add(g, mat, c, rotY, { half: new THREE.Vector3(pw / 2, (winH + winW / 2) / 2, t / 2) });
    }
    // Round arch heads + dark glazing.
    for (let i = 0; i < count; i++) {
      const cx = -w / 2 + pitch * (i + 0.5);
      const base = centre.clone().addScaledVector(dir, cx);
      this.archHead(base.clone().setY(centre.y - h / 2 + sillY + winH), winW, t, rotY, mat);
      this.glazing(base.clone().setY(centre.y - h / 2 + sillY + winH / 2), winW * 0.9, winH, rotY);
    }
  }

  /** Semicircular arch head: a half annulus extruded through the wall. */
  private archHead(at: THREE.Vector3, span: number, t: number, rotY: number, mat: THREE.Material) {
    const r = span / 2;
    const seg = 9;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, r + 0.22, 0, Math.PI, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r, Math.PI, 0, true);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: seg });
    g.translate(0, 0, -t / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(at);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    this.track(g);
  }

  /** Window glass - emissive at night, handled by the day/night cycle. */
  private glazing(at: THREE.Vector3, w: number, h: number, rotY: number) {
    const mat = this.assets.plain(0x1b2230, 0.25, 0.1);
    mat.emissive = new THREE.Color(0xffc877);
    mat.emissiveIntensity = 0;
    (mat as any).__isGlazing = true;
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(at);
    m.rotation.y = rotY;
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = 'glazing';
    this.group.add(m);
    this.track(g);
  }

  // ---------------------------------------------------------------- roofs

  /** Pitched slate roof. */
  gableRoof(centre: THREE.Vector3, w: number, d: number, rise: number, rotY = 0) {
    const g = new THREE.BufferGeometry();
    const hw = w / 2, hd = d / 2;
    const v = new Float32Array([
      -hw, 0, -hd, hw, 0, -hd, 0, rise, -hd,
      -hw, 0, hd, hw, 0, hd, 0, rise, hd,
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.setIndex([
      0, 3, 2, 2, 3, 5,   // left slope
      1, 2, 4, 4, 2, 5,   // right slope
      0, 2, 1,            // front gable
      3, 4, 5,            // back gable
    ]);
    g.computeVertexNormals();
    // Stretch UVs along the slope so slate scale reads correctly.
    const uv = new Float32Array([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1]);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, this.slate(Math.max(2, Math.round(d / 4))));
    m.position.copy(centre);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    this.track(g);
    // Collider: a flattened box just under the ridge keeps the player off the roof.
    if (this.physics) {
      this.physics.addBox(
        centre.clone().setY(centre.y + rise * 0.5),
        new THREE.Vector3(w / 2, rise * 0.5, d / 2), rotY,
      );
    }
  }

  /** Square tower with a pyramidal slate cap - the twin west front. */
  tower(base: THREE.Vector3, side: number, h: number, capRise: number, rotY = 0) {
    const g = new THREE.BoxGeometry(side, h, side);
    this.add(g, this.sandstone(3), base.clone().setY(base.y + h / 2), rotY, {
      half: new THREE.Vector3(side / 2, h / 2, side / 2),
    });
    // Belfry openings on each face.
    for (let i = 0; i < 4; i++) {
      const a = rotY + (i * Math.PI) / 2;
      const d = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(side / 2 + 0.01);
      this.glazing(base.clone().setY(base.y + h - 3.2).add(d), side * 0.26, 2.0, a);
    }
    const cap = new THREE.ConeGeometry(side * 0.72, capRise, 4, 1);
    const m = new THREE.Mesh(cap, this.slate(2));
    m.position.copy(base).setY(base.y + h + capRise / 2);
    m.rotation.y = rotY + Math.PI / 4;
    m.castShadow = true;
    this.group.add(m);
    this.track(cap);
  }

  /** Flat buttress against a wall face. */
  buttress(at: THREE.Vector3, w: number, h: number, proj: number, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, proj);
    this.add(g, this.sandstone(1.5), at.clone().setY(at.y + h / 2), rotY, {
      half: new THREE.Vector3(w / 2, h / 2, proj / 2),
    });
    // Sloped weathering cap.
    const cap = new THREE.ConeGeometry(w * 0.78, 0.7, 4, 1);
    const m = new THREE.Mesh(cap, this.slate(1));
    m.position.copy(at).setY(at.y + h + 0.35);
    m.rotation.y = rotY + Math.PI / 4;
    m.castShadow = true;
    this.group.add(m);
    this.track(cap);
  }

  /**
   * Round-arched doorway. Leaves a real gap in the wall line so the player can
   * walk through - colliders are placed only on the flanking piers and lintel.
   */
  doorway(centre: THREE.Vector3, wallW: number, wallH: number, t: number, openW: number, openH: number, rotY = 0) {
    const mat = this.sandstone(2);
    const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const pierW = (wallW - openW) / 2;

    for (const s of [-1, 1]) {
      const c = centre.clone()
        .addScaledVector(dir, s * (openW / 2 + pierW / 2))
        .setY(centre.y - wallH / 2 + openH / 2);
      const g = new THREE.BoxGeometry(pierW, openH, t);
      this.add(g, mat, c, rotY, { half: new THREE.Vector3(pierW / 2, openH / 2, t / 2) });
    }
    const aboveH = wallH - openH - openW / 2;
    if (aboveH > 0.05) {
      const c = centre.clone().setY(centre.y - wallH / 2 + openH + openW / 2 + aboveH / 2);
      const g = new THREE.BoxGeometry(wallW, aboveH, t);
      this.add(g, mat, c, rotY, { half: new THREE.Vector3(wallW / 2, aboveH / 2, t / 2) });
    }
    this.archHead(centre.clone().setY(centre.y - wallH / 2 + openH), openW, t, rotY, mat);

    // Open timber door leaf, swung aside. No collider: this is the way in.
    const leaf = new THREE.BoxGeometry(openW * 0.92, openH * 0.96, 0.08);
    const lm = new THREE.Mesh(leaf, this.assets.material('woodtable', { repeat: 1, color: 0x6b4a2f }));
    lm.position.copy(centre)
      .addScaledVector(dir, -openW * 0.42)
      .setY(centre.y - wallH / 2 + openH / 2);
    lm.rotation.y = rotY + Math.PI / 2.3;
    lm.castShadow = true;
    this.group.add(lm);
    this.track(leaf);
  }

  /** Simple floor slab. */
  floor(centre: THREE.Vector3, w: number, d: number, matName: string, repeat: number, rotY = 0) {
    const g = new THREE.BoxGeometry(w, 0.3, d);
    this.add(g, this.assets.material(matName, { repeat }), centre, rotY, {
      half: new THREE.Vector3(w / 2, 0.15, d / 2), shadow: false,
    });
  }

  /** Stone terrace retaining wall (vineyard terraces, forecourt edges). */
  retainingWall(from: THREE.Vector3, to: THREE.Vector3, h: number) {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    if (len < 0.5) return;
    const rotY = Math.atan2(-d.z, d.x);
    const centre = from.clone().addScaledVector(d, 0.5).setY((from.y + to.y) / 2 + h / 2);
    const g = new THREE.BoxGeometry(len, h, 0.55);
    this.add(g, this.assets.material('brick', { repeat: Math.max(1, Math.round(len / 3)) }), centre, rotY, {
      half: new THREE.Vector3(len / 2, h / 2, 0.275),
    });
  }
}
