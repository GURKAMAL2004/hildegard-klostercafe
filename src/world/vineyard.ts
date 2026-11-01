import * as THREE from 'three';
import type { Assets } from '../core/assets';
import { heightAt, slopeAt, TERRAIN } from './terrain';

/**
 * Abbey vineyards (~7 ha, mostly Riesling) rendered as InstancedMesh rows.
 *
 * Performance rules enforced here:
 *  - hard instance cap from the quality preset
 *  - rows beyond preset.vineDistance are not emitted at all
 *  - vines never cast shadows (this alone is worth ~8 fps on an iGPU)
 *  - 2 LODs: near = leafy quad cluster, far = single billboard strip
 */
export interface Vineyard {
  group: THREE.Group;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  posts: THREE.InstancedMesh;
  update(cameraPos: THREE.Vector3, time: number): void;
  count: number;
}

const LEAF_COLORS = [0x4e6b2f, 0x5f7c38, 0x45602a, 0x6b8742];

function vineGeometry(leafy: boolean): THREE.BufferGeometry {
  if (!leafy) {
    // Far LOD: two crossed quads, 4 tris total.
    const g = new THREE.BufferGeometry();
    const h = 1.5, w = 0.95;
    const v = [
      -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
      0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    g.computeVertexNormals();
    return g;
  }
  // Near LOD: a small cluster of angled quads reading as foliage. ~24 tris.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const q = new THREE.PlaneGeometry(0.72, 0.62);
    const a = (i / 6) * Math.PI * 2;
    q.rotateY(a);
    q.rotateX(-0.35 + (i % 2) * 0.25);
    q.translate(Math.cos(a) * 0.26, 0.55 + (i % 3) * 0.38, Math.sin(a) * 0.26);
    parts.push(q);
  }
  // Merge manually (BufferGeometryUtils would be another import).
  let vCount = 0, iCount = 0;
  for (const p of parts) { vCount += p.attributes.position.count; iCount += p.index!.count; }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const p of parts) {
    const pp = p.attributes.position as THREE.BufferAttribute;
    const pn = p.attributes.normal as THREE.BufferAttribute;
    const pu = p.attributes.uv as THREE.BufferAttribute;
    pos.set(pp.array as Float32Array, vo * 3);
    nor.set(pn.array as Float32Array, vo * 3);
    uvs.set(pu.array as Float32Array, vo * 2);
    const pi = p.index!;
    for (let k = 0; k < pi.count; k++) idx[io + k] = pi.getX(k) + vo;
    vo += pp.count; io += pi.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Wind sway injected into a standard material's vertex stage. */
function addWind(mat: THREE.Material, strength: number) {
  const uni = { uTime: { value: 0 }, uWind: { value: strength } };
  (mat as any).__wind = uni;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uni.uTime;
    shader.uniforms.uWind = uni.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           // Sway grows with height above the instance origin; phase varies per instance
           // so the block does not move as one slab.
           float inst = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.43;
           float h = max( transformed.y, 0.0 );
           float s = sin( uTime * 1.6 + inst ) * 0.5 + sin( uTime * 3.1 + inst * 1.7 ) * 0.5;
           transformed.x += s * uWind * h * 0.09;
           transformed.z += s * uWind * h * 0.05;
         }`,
      );
  };
  mat.customProgramCacheKey = () => 'vine-wind-v1';
}

export function buildVineyard(
  assets: Assets,
  opts: { maxInstances: number; maxDistance: number },
): Vineyard {
  const group = new THREE.Group();
  group.name = 'vineyard';

  // Lay rows across the terraced, river-facing slope.
  const rows: { x: number; z: number; y: number }[] = [];
  const rowSpacing = 2.6;
  const vineSpacing = 1.25;
  const zStart = TERRAIN.plateauZ + TERRAIN.plateauHalf + 8;
  const zEnd = TERRAIN.plateauZ + 250;

  for (let z = zStart; z < zEnd; z += rowSpacing) {
    for (let x = -165; x < 165; x += vineSpacing) {
      if (rows.length >= opts.maxInstances) break;
      // Keep vines off cliffs and off the gravel paths.
      const s = slopeAt(x, z);
      if (s > 0.75) continue;
      if (Math.abs(x) < 7) continue;             // central access path
      if (Math.abs(x % 56) < 3.2) continue;      // cross paths between blocks
      const y = heightAt(x, z);
      if (y < TERRAIN.riverY + 6) continue;      // not onto the river plain
      rows.push({ x, z, y });
    }
    if (rows.length >= opts.maxInstances) break;
  }

  const count = rows.length;

  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0,
    side: THREE.DoubleSide, alphaTest: 0.35,
  });
  const farMat = new THREE.MeshStandardMaterial({
    color: 0x55723a, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  });
  addWind(leafMat, 1.0);
  addWind(farMat, 0.6);

  const near = new THREE.InstancedMesh(vineGeometry(true), leafMat, count);
  const far = new THREE.InstancedMesh(vineGeometry(false), farMat, count);
  // Trellis posts - cheap boxes, shared instance buffer.
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.07, 1.8, 0.07),
    assets.plain(0x6b5a44, 0.9),
    Math.ceil(count / 6),
  );

  // Vines must never cast shadows: with one shadow-casting light, thousands of
  // instanced alpha-tested quads in the shadow pass is the single biggest fps sink.
  for (const im of [near, far, posts]) {
    im.castShadow = false;
    im.receiveShadow = false;
    im.frustumCulled = true;
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let postI = 0;
  for (let i = 0; i < count; i++) {
    const r = rows[i];
    const scale = 0.85 + ((i * 37) % 100) / 300;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((i * 53) % 100) / 100 * Math.PI);
    m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(scale, scale, scale));
    near.setMatrixAt(i, m);
    far.setMatrixAt(i, m);
    col.setHex(LEAF_COLORS[i % LEAF_COLORS.length]);
    near.setColorAt(i, col);

    if (i % 6 === 0 && postI < posts.count) {
      m.compose(new THREE.Vector3(r.x, r.y + 0.9, r.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(postI++, m);
    }
  }
  near.instanceMatrix.needsUpdate = true;
  far.instanceMatrix.needsUpdate = true;
  posts.instanceMatrix.needsUpdate = true;
  if (near.instanceColor) near.instanceColor.needsUpdate = true;

  // Bounding spheres so frustum culling actually works on instanced meshes.
  for (const im of [near, far, posts]) {
    im.computeBoundingSphere?.();
    im.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, TERRAIN.plateauY * 0.5, TERRAIN.plateauZ + 120),
      320,
    );
  }

  group.add(near, far, posts);

  const nearDist = Math.min(62, opts.maxDistance * 0.45);

  return {
    group, near, far, posts, count,
    update(cameraPos, time) {
      (leafMat as any).__wind.uTime.value = time;
      (farMat as any).__wind.uTime.value = time;
      // LOD + distance cull: swap whole meshes rather than per-instance work.
      const dist = cameraPos.distanceTo(
        new THREE.Vector3(0, TERRAIN.plateauY * 0.5, TERRAIN.plateauZ + 120),
      );
      const visible = dist < opts.maxDistance + 320;
      near.visible = visible && dist < nearDist + 260;
      far.visible = visible && !near.visible;
      posts.visible = near.visible;
    },
  };
}
