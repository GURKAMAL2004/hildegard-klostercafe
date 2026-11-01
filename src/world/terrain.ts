import * as THREE from 'three';
import type { Assets } from '../core/assets';

/**
 * Site layout (metres, world origin = abbey forecourt):
 *   +Z is downhill toward the Rhine (south).
 *   The abbey sits on a flat plateau; vineyard terraces step down to the river plain.
 */
export const TERRAIN = {
  size: 900,        // square extent
  seg: 160,         // mesh resolution (160x160 quads = ~51k tris, acceptable)
  plateauY: 92,     // abbey plateau height
  riverY: 2,        // Rhine surface
  plateauZ: -40,    // plateau centre
  plateauHalf: 95,  // flat radius around the abbey
  slopeEnd: 300,    // where the slope meets the river plain
};

/** Cheap deterministic value noise - no dependency, stable across mesh/collider. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x: number, y: number, oct = 4): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
  return s;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * THE authoritative ground height. Used by the render mesh, the physics
 * heightfield, and every object placement helper - so they cannot disagree.
 */
export function heightAt(x: number, z: number): number {
  const { plateauY, riverY, plateauZ, plateauHalf, slopeEnd } = TERRAIN;

  // Distance "down the hill" measured from the plateau edge.
  const d = Math.max(
    Math.abs(z - plateauZ) - plateauHalf,
    Math.abs(x) - plateauHalf * 1.5,
  );

  let h: number;
  if (d <= 0) {
    // Flat abbey plateau, with a whisper of unevenness so it is not glassy.
    h = plateauY + fbm(x * 0.012, z * 0.012, 2) * 0.5;
  } else {
    // Main hillside: ease from plateau height down to the river plain.
    const t = smoothstep(0, slopeEnd - plateauHalf, d);
    h = plateauY + (riverY - plateauY) * t;

    // Vineyard terracing - discrete steps, only on the river-facing slope.
    if (z > plateauZ && d > 6 && d < slopeEnd - plateauHalf - 10) {
      const step = 11.5;
      const terrace = Math.floor(d / step);
      const frac = (d % step) / step;
      // Flat tread + short riser: the classic Rheingau terrace profile.
      const tread = 0.82;
      const local = frac < tread ? 0 : (frac - tread) / (1 - tread);
      const stepDrop = ((plateauY - riverY) / ((slopeEnd - plateauHalf) / step)) * 0.92;
      h = plateauY - terrace * stepDrop - local * stepDrop;
      h += fbm(x * 0.05, z * 0.05, 2) * 0.35;
    } else {
      h += fbm(x * 0.02, z * 0.02, 3) * 4.5 * (1 - smoothstep(0, 120, d) * 0.6);
    }
  }

  // River plain flattens out.
  const plain = smoothstep(slopeEnd - 40, slopeEnd + 60, Math.abs(z - plateauZ));
  h = h * (1 - plain) + riverY * plain;

  return h;
}

/** Slope magnitude (0 = flat) - used to keep vines and props off cliffs. */
export function slopeAt(x: number, z: number, e = 1.2): number {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.sqrt(hx * hx + hz * hz) / (2 * e);
}

export interface TerrainResult {
  mesh: THREE.Mesh;
  heights: Float32Array;  // for the Rapier heightfield
  nrows: number;
  ncols: number;
  scale: { x: number; y: number; z: number };
}

export function buildTerrain(assets: Assets): TerrainResult {
  const { size, seg } = TERRAIN;

  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2); // into XZ
  const pos = geo.attributes.position as THREE.BufferAttribute;

  // Blend weight per vertex: 0 = grass/soil, 1 = rock. Drives a 2-texture splat.
  const blend = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    blend[i] = Math.min(1, slopeAt(x, z) * 1.5);
  }
  geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 1));
  geo.computeVertexNormals();

  const mat = assets.material('soil', { repeat: 110, roughness: 0.95 });
  const rock = assets.material('gravel', { repeat: 90 }).map;

  // Two-texture splat by slope, injected into the standard material so we keep
  // PBR lighting and shadows without writing a whole custom shader.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRock = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBlend;\nvarying float vBlend;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = aBlend;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRock;\nvarying float vBlend;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           vec4 rockCol = texture2D( uRock, vMapUv * 0.8 );
           #ifdef USE_MAP
             diffuseColor.rgb = mix( diffuseColor.rgb, rockCol.rgb, clamp(vBlend,0.0,1.0) );
           #endif
         }`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // --- Rapier heightfield data ---
  // Rapier expects (nrows+1)*(ncols+1) heights in COLUMN-major order and a scale
  // giving the total extents. We sample the same heightAt() so physics matches art.
  const n = seg;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -size / 2 + (i / n) * size;
      const z = -size / 2 + (j / n) * size;
      heights[j * (n + 1) + i] = heightAt(x, z);
    }
  }

  return {
    mesh,
    heights,
    nrows: n,
    ncols: n,
    scale: { x: size, y: 1, z: size },
  };
}

/** Distant hill silhouette ring, so the horizon is not an empty edge. */
export function buildHorizon(assets: Assets): THREE.Mesh {
  const R = 1150;
  const seg = 96;
  const pts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const h = 40 + fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 4) * 120;
    pts.push(x, -10, z, x, h, z);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ color: 0x6d7f8e, fog: true, side: THREE.BackSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'horizon';
  return mesh;
}

/** The Rhine: a flat plane far downhill with a scrolling normal map. */
export function buildRiver(assets: Assets, detail: boolean): THREE.Mesh {
  const g = new THREE.PlaneGeometry(2400, 620, 1, 1);
  g.rotateX(-Math.PI / 2);
  const nor = assets.manifest.textures['sandstone']?.maps.nor;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3c5a6b,
    roughness: 0.12,
    metalness: 0.5,
    transparent: true,
    opacity: 0.93,
  });
  if (detail && nor) {
    const t = assets.material('sandstone', { repeat: 26 }).normalMap;
    if (t) {
      mat.normalMap = t.clone();
      mat.normalMap.needsUpdate = true;
      mat.normalScale.set(0.18, 0.18);
    }
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(0, TERRAIN.riverY + 0.4, TERRAIN.plateauZ + 560);
  mesh.name = 'rhine';
  mesh.receiveShadow = false;
  (mesh as any).__scroll = mat;
  return mesh;
}
