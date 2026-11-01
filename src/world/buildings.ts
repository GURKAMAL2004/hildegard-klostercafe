import * as THREE from 'three';
import type { Assets } from '../core/assets';
import type { Physics } from '../core/physics';
import { Kit } from './kit';
import { heightAt, TERRAIN } from './terrain';

/**
 * Site plan. Massing follows the reference photos: a long nave running E-W with a
 * twin-tower west front, a cloister wing to the north, and the cafe + Klosterladen
 * wings forming the forecourt to the east.
 *
 * Coordinates are world metres. The plateau is flat at TERRAIN.plateauY, so we read
 * the ground once and build everything relative to it.
 */
export const GROUND = heightAt(0, TERRAIN.plateauZ);

export const LAYOUT = {
  church:   { x: -34, z: TERRAIN.plateauZ - 6, w: 20, d: 56, h: 15 },
  towers:   { side: 7.4, h: 30, cap: 9 },
  cloister: { x: -34, z: TERRAIN.plateauZ + 34, w: 34, d: 20, h: 9.5 },
  cafe:     { x: 22, z: TERRAIN.plateauZ + 10, w: 24, d: 17, h: 7.2 },
  shop:     { x: 22, z: TERRAIN.plateauZ - 16, w: 17, d: 13, h: 6.4 },
  carpark:  { x: 62, z: TERRAIN.plateauZ + 52 },
  terrace:  { x: 22, z: TERRAIN.plateauZ + 25 },
};

/** Where the player spawns: the car park, as the brief's Phase 5 walk requires. */
export const SPAWN = new THREE.Vector3(
  LAYOUT.carpark.x,
  heightAt(LAYOUT.carpark.x, LAYOUT.carpark.z) + 2.0, // 2 m above ground, failure mode #7
  LAYOUT.carpark.z,
);

/** Counter interaction point, filled in by buildCafe. */
export const COUNTER = new THREE.Vector3();
export const CAFE_DOOR = new THREE.Vector3();

export interface BuiltWorld {
  group: THREE.Group;
  triangles: number;
  tables: THREE.Vector3[];
  baristaAt: THREE.Vector3;
}

export function buildBuildings(assets: Assets, physics: Physics): BuiltWorld {
  const kit = new Kit(assets, physics);
  const g = kit.group;
  const y = GROUND;
  const tables: THREE.Vector3[] = [];

  // ================================================================ forecourt
  // Gravel forecourt + paths. Slightly raised so it reads as a made surface.
  kit.floor(new THREE.Vector3(14, y + 0.08, TERRAIN.plateauZ + 4), 86, 76, 'gravel', 26);
  kit.floor(new THREE.Vector3(LAYOUT.carpark.x, heightAt(LAYOUT.carpark.x, LAYOUT.carpark.z) + 0.08, LAYOUT.carpark.z), 30, 24, 'cobble', 12);

  // Path from car park down to the forecourt.
  kit.floor(new THREE.Vector3(44, y + 0.09, TERRAIN.plateauZ + 32), 14, 46, 'gravel', 10, 0.18);

  // ================================================================ church
  const c = LAYOUT.church;
  // Nave side walls, with the long run of round-arched windows.
  for (const s of [-1, 1]) {
    kit.wall(
      new THREE.Vector3(c.x + s * c.w / 2, y + c.h / 2, c.z),
      c.d, c.h, 1.1,
      Math.PI / 2,
      { count: 9, sillY: 5.2, winW: 1.9, winH: 3.6 },
      6,
    );
  }
  // East end: apse (half cylinder) + choir wall.
  const apse = new THREE.CylinderGeometry(c.w / 2, c.w / 2, c.h, 10, 1, true, -Math.PI / 2, Math.PI);
  const apseMesh = new THREE.Mesh(apse, assets.material('sandstone', { repeat: 4, color: 0xc89b7d }));
  apseMesh.position.set(c.x, y + c.h / 2, c.z - c.d / 2);
  apseMesh.rotation.y = Math.PI;
  apseMesh.castShadow = apseMesh.receiveShadow = true;
  g.add(apseMesh);
  physics.addBox(
    new THREE.Vector3(c.x, y + c.h / 2, c.z - c.d / 2 - c.w / 4),
    new THREE.Vector3(c.w / 2, c.h / 2, c.w / 4),
  );
  const apseRoof = new THREE.ConeGeometry(c.w / 2 + 0.3, 6, 10, 1, false, -Math.PI / 2, Math.PI);
  const arm = new THREE.Mesh(apseRoof, assets.material('slate', { repeat: 3, color: 0x6a717a }));
  arm.position.set(c.x, y + c.h + 3, c.z - c.d / 2);
  arm.rotation.y = Math.PI;
  arm.castShadow = true;
  g.add(arm);

  // West front: the main door between the twin towers.
  kit.doorway(
    new THREE.Vector3(c.x, y + c.h / 2, c.z + c.d / 2),
    c.w, c.h, 1.1, 3.4, 5.2, 0,
  );
  // Rose-ish round window above the door.
  kit.wall(
    new THREE.Vector3(c.x, y + c.h + 2.2, c.z + c.d / 2),
    c.w, 4.4, 1.1, 0,
    { count: 1, sillY: 0.6, winW: 3.0, winH: 1.4 }, 3,
  );

  // Nave roof.
  kit.gableRoof(new THREE.Vector3(c.x, y + c.h, c.z), c.w + 0.8, c.d + 0.6, 7.5, Math.PI / 2);

  // Twin west towers.
  const t = LAYOUT.towers;
  for (const s of [-1, 1]) {
    const tx = c.x + s * (c.w / 2 + t.side / 2 - 0.6);
    const tz = c.z + c.d / 2 + t.side / 2 - 1.2;
    kit.tower(new THREE.Vector3(tx, y, tz), t.side, t.h, t.cap);
  }

  // Buttresses along the nave.
  for (let i = 0; i < 8; i++) {
    const bz = c.z - c.d / 2 + 5 + i * 6.6;
    for (const s of [-1, 1]) {
      kit.buttress(new THREE.Vector3(c.x + s * (c.w / 2 + 0.45), y, bz), 1.1, c.h - 3.5, 0.9, 0);
    }
  }

  buildChurchInterior(assets, g, c, y);

  // ================================================================ cloister wing
  const cl = LAYOUT.cloister;
  for (const s of [-1, 1]) {
    kit.wall(new THREE.Vector3(cl.x, y + cl.h / 2, cl.z + s * cl.d / 2), cl.w, cl.h, 0.9, 0,
      { count: 7, sillY: 2.6, winW: 1.3, winH: 2.2 }, 5);
  }
  for (const s of [-1, 1]) {
    kit.wall(new THREE.Vector3(cl.x + s * cl.w / 2, y + cl.h / 2, cl.z), cl.d, cl.h, 0.9, Math.PI / 2,
      { count: 4, sillY: 2.6, winW: 1.3, winH: 2.2 }, 4);
  }
  kit.gableRoof(new THREE.Vector3(cl.x, y + cl.h, cl.z), cl.d + 0.6, cl.w + 0.6, 4.6, 0);

  // ================================================================ cafe wing
  const cf = LAYOUT.cafe;
  CAFE_DOOR.set(cf.x - cf.w / 2, y, cf.z + 2);

  // North wall (solid, backs onto the counter).
  kit.wall(new THREE.Vector3(cf.x, y + cf.h / 2, cf.z - cf.d / 2), cf.w, cf.h, 0.8, 0,
    { count: 4, sillY: 3.4, winW: 1.2, winH: 1.6 }, 6);
  // South wall: big windows looking down to the Rhine.
  kit.wall(new THREE.Vector3(cf.x, y + cf.h / 2, cf.z + cf.d / 2), cf.w, cf.h, 0.8, 0,
    { count: 5, sillY: 1.1, winW: 2.5, winH: 3.0 }, 6);
  // East wall.
  kit.wall(new THREE.Vector3(cf.x + cf.w / 2, y + cf.h / 2, cf.z), cf.d, cf.h, 0.8, Math.PI / 2,
    { count: 3, sillY: 1.2, winW: 1.8, winH: 2.6 }, 5);
  // West wall WITH the entrance the player walks through.
  kit.doorway(new THREE.Vector3(cf.x - cf.w / 2, y + cf.h / 2, cf.z + 2), cf.d * 0.55, cf.h, 0.8, 2.6, 4.2, Math.PI / 2);
  kit.wall(new THREE.Vector3(cf.x - cf.w / 2, y + cf.h / 2, cf.z - cf.d / 2 + cf.d * 0.22), cf.d * 0.45, cf.h, 0.8, Math.PI / 2,
    { count: 2, sillY: 1.2, winW: 1.4, winH: 2.4 }, 4);

  // Interior floor + ceiling.
  kit.floor(new THREE.Vector3(cf.x, y + 0.12, cf.z), cf.w - 1.4, cf.d - 1.4, 'woodfloor', 9);
  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(cf.w, 0.3, cf.d),
    assets.material('plaster', { repeat: 5, color: 0xe8ddc8 }),
  );
  ceil.position.set(cf.x, y + cf.h - 0.15, cf.z);
  ceil.receiveShadow = false;
  g.add(ceil);
  physics.addBox(ceil.position.clone(), new THREE.Vector3(cf.w / 2, 0.15, cf.d / 2));

  kit.gableRoof(new THREE.Vector3(cf.x, y + cf.h, cf.z), cf.w + 1, cf.d + 1, 5.2, 0);

  buildCafeInterior(assets, physics, g, cf, y, tables);

  // ================================================================ shop / Vinothek
  const sh = LAYOUT.shop;
  kit.wall(new THREE.Vector3(sh.x, y + sh.h / 2, sh.z - sh.d / 2), sh.w, sh.h, 0.8, 0, null, 5);
  kit.wall(new THREE.Vector3(sh.x, y + sh.h / 2, sh.z + sh.d / 2), sh.w, sh.h, 0.8, 0,
    { count: 3, sillY: 1.2, winW: 1.9, winH: 2.4 }, 5);
  kit.wall(new THREE.Vector3(sh.x + sh.w / 2, y + sh.h / 2, sh.z), sh.d, sh.h, 0.8, Math.PI / 2, null, 4);
  kit.doorway(new THREE.Vector3(sh.x - sh.w / 2, y + sh.h / 2, sh.z), sh.d, sh.h, 0.8, 2.2, 3.6, Math.PI / 2);
  kit.gableRoof(new THREE.Vector3(sh.x, y + sh.h, sh.z), sh.w + 0.8, sh.d + 0.8, 4.2, 0);

  // ================================================================ terrace + sculpture park
  const te = LAYOUT.terrace;
  kit.floor(new THREE.Vector3(te.x, y + 0.14, te.z), 22, 12, 'stonetile', 8);
  kit.retainingWall(
    new THREE.Vector3(te.x - 11, y, te.z + 6),
    new THREE.Vector3(te.x + 11, y, te.z + 6), 0.9,
  );
  buildTerraceFurniture(assets, physics, g, te, y, tables);
  buildSculpturePark(assets, g, y);

  return { group: g, triangles: kit.triangles, tables, baristaAt: COUNTER.clone().add(new THREE.Vector3(0, 0, -1.6)) };
}

// -------------------------------------------------------------------- interiors

function buildChurchInterior(assets: Assets, g: THREE.Group, c: typeof LAYOUT.church, y: number) {
  // Stone floor.
  const fl = new THREE.Mesh(
    new THREE.BoxGeometry(c.w - 2.2, 0.2, c.d - 2.2),
    assets.material('stonetile', { repeat: 10 }),
  );
  fl.position.set(c.x, y + 0.2, c.z);
  fl.receiveShadow = true;
  g.add(fl);

  // Pews.
  const pewGeo = new THREE.BoxGeometry(5.4, 0.9, 0.42);
  const pewMat = assets.material('woodtable', { repeat: 2, color: 0x5a3d28 });
  const pews = new THREE.InstancedMesh(pewGeo, pewMat, 26);
  pews.castShadow = false;
  pews.receiveShadow = true;
  const m = new THREE.Matrix4();
  let k = 0;
  for (let row = 0; row < 13; row++) {
    for (const s of [-1, 1]) {
      m.makeTranslation(c.x + s * 4.2, y + 0.65, c.z - 14 + row * 2.6);
      pews.setMatrixAt(k++, m);
    }
  }
  pews.instanceMatrix.needsUpdate = true;
  g.add(pews);

  // Apse mural: ORIGINAL procedural gold pattern, deliberately NOT a copy of the
  // Beuron-school artwork. Concentric arcs + radial rays in gold on deep blue.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#17213a';
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = i % 3 === 0 ? '#d9a93f' : '#8f6f2a';
    x.lineWidth = i % 3 === 0 ? 3 : 1.4;
    x.beginPath();
    x.arc(256, 470, 40 + i * 17, Math.PI, 0);
    x.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = Math.PI + (i / 23) * Math.PI;
    x.strokeStyle = 'rgba(217,169,63,0.5)';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(256, 470);
    x.lineTo(256 + Math.cos(a) * 470, 470 + Math.sin(a) * 470);
    x.stroke();
  }
  // Simple mandorla motif, geometric only.
  x.fillStyle = 'rgba(217,169,63,0.22)';
  x.beginPath();
  x.ellipse(256, 300, 70, 130, 0, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#d9a93f';
  x.lineWidth = 4;
  x.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mural = new THREE.Mesh(
    new THREE.CylinderGeometry(c.w / 2 - 0.7, c.w / 2 - 0.7, c.h - 3, 10, 1, true, -Math.PI / 2, Math.PI),
    new THREE.MeshStandardMaterial({ map: tex, side: THREE.BackSide, roughness: 0.6, metalness: 0.25 }),
  );
  mural.position.set(c.x, y + (c.h - 3) / 2 + 0.3, c.z - c.d / 2);
  mural.rotation.y = Math.PI;
  g.add(mural);

  // Altar + organ silhouette.
  const altar = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.1, 1.3),
    assets.material('stonetile', { repeat: 2, color: 0xd8cbb4 }),
  );
  altar.position.set(c.x, y + 0.85, c.z - c.d / 2 + 4.5);
  altar.castShadow = true;
  g.add(altar);

  const organ = new THREE.Mesh(
    new THREE.BoxGeometry(7.5, 8.5, 1.6),
    assets.plain(0x4a3524, 0.75),
  );
  organ.position.set(c.x, y + 5.5, c.z + c.d / 2 - 2.4);
  g.add(organ);
  for (let i = 0; i < 11; i++) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 2.4 + (i % 4) * 1.5, 6),
      assets.plain(0xa9a2a0, 0.35, 0.75),
    );
    pipe.position.set(c.x - 3.2 + i * 0.64, y + 8 + ((i % 4) * 1.5) / 2, c.z + c.d / 2 - 1.7);
    g.add(pipe);
  }
}

function buildCafeInterior(
  assets: Assets, physics: Physics, g: THREE.Group,
  cf: typeof LAYOUT.cafe, y: number, tables: THREE.Vector3[],
) {
  // --- self-service counter along the north wall ---
  const counterZ = cf.z - cf.d / 2 + 2.2;
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(9.5, 1.05, 0.85),
    assets.material('woodtable', { repeat: 3, color: 0x7a5435 }),
  );
  counter.position.set(cf.x - 1, y + 0.78, counterZ);
  counter.castShadow = true;
  counter.receiveShadow = true;
  g.add(counter);
  physics.addBox(counter.position.clone(), new THREE.Vector3(4.75, 0.53, 0.43));

  // Stone top.
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(9.8, 0.1, 1.0),
    assets.material('stonetile', { repeat: 3, color: 0xcfc3ad }),
  );
  top.position.set(cf.x - 1, y + 1.33, counterZ);
  top.castShadow = true;
  g.add(top);

  // The point the player interacts from (in front of the counter).
  COUNTER.set(cf.x - 1, y, counterZ + 1.5);

  // --- glass cake display ---
  const caseGlass = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.95, 0.95),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16,
      roughness: 0.05, metalness: 0, transmission: 0.85, thickness: 0.3,
    }),
  );
  caseGlass.position.set(cf.x - 3.4, y + 1.86, counterZ);
  g.add(caseGlass);

  // Procedural cakes on two shelves.
  const cakeCols = [0xd9a05b, 0x8d5524, 0xe6c79c, 0xb5651d, 0xf0e2c0];
  for (let i = 0; i < 8; i++) {
    const r = 0.26 + (i % 3) * 0.04;
    const cake = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.17, 12),
      assets.plain(cakeCols[i % cakeCols.length], 0.65),
    );
    cake.position.set(
      cf.x - 4.9 + (i % 4) * 0.95,
      y + (i < 4 ? 1.58 : 2.05),
      counterZ + (i < 4 ? -0.1 : 0.1),
    );
    cake.castShadow = false;
    g.add(cake);
    // A wedge removed from a couple of them, for life.
    if (i % 3 === 0) {
      const slice = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 0.18, 12, 1, false, 0, Math.PI / 5),
        assets.plain(0xf5ead6, 0.7),
      );
      slice.position.copy(cake.position);
      g.add(slice);
    }
  }

  // --- coffee machine ---
  const machine = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.75, 0.6),
    assets.plain(0x2a2d33, 0.35, 0.8),
  );
  machine.position.set(cf.x + 2.6, y + 1.72, counterZ - 0.1);
  machine.castShadow = true;
  g.add(machine);
  for (const dx of [-0.22, 0.22]) {
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), assets.plain(0xb8bcc2, 0.3, 0.9));
    spout.position.set(cf.x + 2.6 + dx, y + 1.45, counterZ + 0.2);
    g.add(spout);
  }

  // --- tables + chairs (10 indoor) ---
  const tableTop = new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14);
  const tableMat = assets.material('woodtable', { repeat: 1, color: 0x8a6240 });
  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.72, 6);
  const chairSeat = new THREE.BoxGeometry(0.42, 0.07, 0.42);
  const chairBack = new THREE.BoxGeometry(0.42, 0.5, 0.06);
  const chairMat = assets.plain(0x6b4a2f, 0.8);

  const spots: [number, number][] = [
    [-5.2, 2.0], [-2.6, 2.0], [0.0, 2.0], [2.6, 2.0], [5.2, 2.0],
    [-5.2, 5.2], [-2.6, 5.2], [0.0, 5.2], [2.6, 5.2], [5.2, 5.2],
  ];
  for (const [dx, dz] of spots) {
    const px = cf.x + dx, pz = cf.z - cf.d / 2 + dz + 1.2;
    const tp = new THREE.Mesh(tableTop, tableMat);
    tp.position.set(px, y + 0.78, pz);
    tp.castShadow = true;
    tp.receiveShadow = true;
    g.add(tp);
    const leg = new THREE.Mesh(legGeo, chairMat);
    leg.position.set(px, y + 0.4, pz);
    g.add(leg);
    physics.addBox(new THREE.Vector3(px, y + 0.4, pz), new THREE.Vector3(0.5, 0.4, 0.5));
    tables.push(new THREE.Vector3(px, y + 0.82, pz));

    for (const [cdx, cdz] of [[0, 0.85], [0, -0.85]] as [number, number][]) {
      const s = new THREE.Mesh(chairSeat, chairMat);
      s.position.set(px + cdx, y + 0.46, pz + cdz);
      s.castShadow = true;
      g.add(s);
      const b = new THREE.Mesh(chairBack, chairMat);
      b.position.set(px + cdx, y + 0.72, pz + cdz + (cdz > 0 ? 0.19 : -0.19));
      g.add(b);
    }
  }

  // --- "Leichte Sprache" / inclusion note board, reflecting the real cafe ---
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.0),
    assets.plain(0xf2e9d8, 0.85),
  );
  board.position.set(cf.x + cf.w / 2 - 0.45, y + 2.3, cf.z + 2.5);
  board.rotation.y = -Math.PI / 2;
  g.add(board);
}

function buildTerraceFurniture(
  assets: Assets, physics: Physics, g: THREE.Group,
  te: typeof LAYOUT.terrace, y: number, tables: THREE.Vector3[],
) {
  const topGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.08, 12);
  const mat = assets.material('woodtable', { repeat: 1, color: 0x7d5a3c });
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6);
  const canopyGeo = new THREE.ConeGeometry(1.75, 0.5, 8);

  for (let i = 0; i < 6; i++) {
    const px = te.x - 8 + (i % 3) * 8;
    const pz = te.z - 3 + Math.floor(i / 3) * 6;
    const tp = new THREE.Mesh(topGeo, mat);
    tp.position.set(px, y + 0.78, pz);
    tp.castShadow = true;
    g.add(tp);
    physics.addBox(new THREE.Vector3(px, y + 0.4, pz), new THREE.Vector3(0.5, 0.4, 0.5));
    tables.push(new THREE.Vector3(px, y + 0.82, pz));

    const pole = new THREE.Mesh(poleGeo, assets.plain(0x8a7f6b, 0.8));
    pole.position.set(px, y + 1.3, pz);
    g.add(pole);
    const canopy = new THREE.Mesh(canopyGeo, assets.plain(i % 2 ? 0xd8cdb4 : 0xc8b99a, 0.9));
    canopy.position.set(px, y + 2.6, pz);
    canopy.castShadow = true;
    g.add(canopy);
  }
}

function buildSculpturePark(assets: Assets, g: THREE.Group, y: number) {
  // Abstract stone forms behind the cafe - the real site has a sculpture park.
  const stone = assets.material('stonetile', { repeat: 1, color: 0xbfb6a4 });
  const place: [number, number, number][] = [
    [34, 30, 0], [41, 36, 1], [28, 38, 2], [45, 27, 1], [36, 44, 0],
  ];
  for (const [dx, dz, kind] of place) {
    const px = LAYOUT.cafe.x + dx - 10;
    const pz = LAYOUT.cafe.z + dz;
    const gy = heightAt(px, pz);
    let mesh: THREE.Mesh;
    if (kind === 0) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), stone);
      mesh.position.set(px, gy + 1.3, pz);
      mesh.rotation.y = dx;
    } else if (kind === 1) {
      mesh = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.24, 6, 14), stone);
      mesh.position.set(px, gy + 1.3, pz);
      mesh.rotation.set(Math.PI / 2.4, dz, 0);
    } else {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.2, 7), stone);
      mesh.position.set(px, gy + 1.1, pz);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 1.3), stone);
    plinth.position.set(px, gy + 0.15, pz);
    plinth.receiveShadow = true;
    g.add(plinth);
  }
}
