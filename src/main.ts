import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SSAOEffect,
  BlendFunction, NormalPass,
} from 'postprocessing';

import { Stats } from './ui/stats';
import { Minimap } from './ui/minimap';
import { Assets } from './core/assets';
import { Physics } from './core/physics';
import { PRESETS, detectDefault, type Preset, type PresetName } from './core/quality';
import { buildTerrain, buildHorizon, buildRiver, heightAt, TERRAIN } from './world/terrain';
import { buildVineyard, type Vineyard } from './world/vineyard';
import { buildBuildings, SPAWN, COUNTER, LAYOUT, GROUND } from './world/buildings';
import { Sky } from './world/sky';
import { Player, type Input } from './player/controller';
import { loadMenu, counts, type Menu } from './cafe/menu';
import { buildMenuBoard } from './cafe/board';
import { Ordering } from './cafe/ordering';

const bootEl = document.getElementById('boot')!;
const bootMsg = document.getElementById('boot-msg')!;
const bar = document.querySelector<HTMLElement>('#bar i')!;
const promptEl = document.getElementById('prompt')!;
const crosshair = document.getElementById('crosshair')!;

function progress(p: number, msg: string) {
  bar.style.width = `${Math.round(p * 100)}%`;
  bootMsg.textContent = msg;
  // Yield so the browser actually paints the progress bar.
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}

async function main() {
  // ---------------------------------------------------------------- renderer
  await progress(0.04, 'Starting renderer…');
  let preset: Preset = PRESETS[detectDefault()];

  const renderer = new THREE.WebGLRenderer({
    antialias: false,            // SMAA handles AA in the composer
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * preset.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.insertBefore(renderer.domElement, document.getElementById('hud'));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9fb4c8, 220, 980);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.12, 2200);
  camera.position.set(SPAWN.x, SPAWN.y + 4, SPAWN.z + 8);

  // ---------------------------------------------------------------- assets
  await progress(0.1, 'Loading texture manifest…');
  const assets = new Assets(renderer);
  await assets.loadManifest();

  await progress(0.18, 'Loading sky (HDRI)…');
  try {
    await assets.loadHDRI(scene);
  } catch (e) {
    console.warn('HDRI failed, falling back to gradient sky', e);
    scene.background = new THREE.Color(0x9fb4c8);
  }

  // ---------------------------------------------------------------- physics
  await progress(0.26, 'Initialising physics (Rapier WASM)…');
  const physics = await Physics.create();   // awaits RAPIER.init() internally

  // ---------------------------------------------------------------- terrain
  await progress(0.36, 'Building hillside…');
  const terrain = buildTerrain(assets);
  scene.add(terrain.mesh);
  physics.addTerrain(terrain);
  scene.add(buildHorizon(assets));
  const river = buildRiver(assets, preset.waterDetail);
  scene.add(river);

  // ---------------------------------------------------------------- vineyard
  await progress(0.48, 'Planting vineyards…');
  let vineyard: Vineyard = buildVineyard(assets, {
    maxInstances: preset.vineInstances,
    maxDistance: preset.vineDistance,
  });
  scene.add(vineyard.group);

  // ---------------------------------------------------------------- buildings
  await progress(0.62, 'Raising the abbey…');
  const built = buildBuildings(assets, physics);
  scene.add(built.group);

  // ---------------------------------------------------------------- menu data
  await progress(0.74, 'Fetching menu…');
  let menu: Menu;
  try {
    menu = await loadMenu();
  } catch (e) {
    console.error(e);
    bootMsg.textContent = 'menu.json missing — run: npm run fetch:menu';
    throw e;
  }
  const c = counts(menu);
  console.log(
    `%cmenu.json%c ${c.verified} verified / ${c.unverified} unverified items`,
    'background:#e8d5a8;color:#2a1d12;padding:1px 5px;border-radius:3px', '',
  );
  if (menu.notes.length) for (const n of menu.notes) console.log('  note:', n);

  // Menu board on the cafe's north wall, above the counter.
  const board = buildMenuBoard(menu);
  board.mesh.position.set(
    LAYOUT.cafe.x + 3.0,
    GROUND + 2.55,
    LAYOUT.cafe.z - LAYOUT.cafe.d / 2 + 0.5,
  );
  scene.add(board.mesh);

  // ---------------------------------------------------------------- lighting
  await progress(0.82, 'Lighting…');
  const sky = new Sky(scene, preset.shadowMapSize, preset.shadows);
  sky.collectGlazing(built.group);

  // Warm interior lights (no shadows - budget allows exactly one shadow caster).
  const interiorLights: THREE.PointLight[] = [];
  const cf = LAYOUT.cafe;
  const spots: [number, number][] = [
    [-6, 3], [0, 3], [6, 3], [-6, 10], [0, 10], [6, 10],
  ];
  for (let i = 0; i < Math.min(preset.interiorLights, spots.length); i++) {
    const [dx, dz] = spots[i];
    const l = new THREE.PointLight(0xffc880, 9, 13, 2);
    l.position.set(cf.x + dx, GROUND + cf.h - 1.3, cf.z - cf.d / 2 + dz);
    l.castShadow = false;
    scene.add(l);
    interiorLights.push(l);
  }

  // ---------------------------------------------------------------- player
  await progress(0.9, 'Spawning…');
  const player = new Player(physics, assets, SPAWN);
  scene.add(player.object);

  // Objects the camera may collide with (walls/roofs, not vines or terrain detail).
  const camColliders: THREE.Object3D[] = [built.group, terrain.mesh];

  // ---------------------------------------------------------------- ordering
  const ordering = new Ordering(
    menu, assets, scene, COUNTER, built.tables, built.baristaAt, promptEl,
  );

  // ---------------------------------------------------------------- post-fx
  await progress(0.95, 'Compiling post-processing…');
  let composer: EffectComposer | null = null;
  let normalPass: NormalPass | null = null;

  function buildComposer(p: Preset) {
    composer?.dispose();
    composer = null;
    normalPass = null;
    if (!p.bloom && !p.smaa && !p.ssao) return;   // Low: render direct, no composer

    composer = new EffectComposer(renderer, { multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));

    const effects: any[] = [];
    if (p.ssao) {
      normalPass = new NormalPass(scene, camera);
      composer.addPass(normalPass);
      effects.push(new SSAOEffect(camera, normalPass.texture, {
        blendFunction: BlendFunction.MULTIPLY,
        samples: 9,
        rings: 4,
        distanceThreshold: 0.35,
        distanceFalloff: 0.1,
        rangeThreshold: 0.001,
        rangeFalloff: 0.004,
        luminanceInfluence: 0.6,
        radius: 0.09,
        intensity: 1.25,
      }));
    }
    if (p.bloom) {
      effects.push(new BloomEffect({
        intensity: 0.75,
        luminanceThreshold: 0.72,
        luminanceSmoothing: 0.3,
        mipmapBlur: true,
      }));
    }
    if (p.smaa) effects.push(new SMAAEffect());
    if (effects.length) composer.addPass(new EffectPass(camera, ...effects));
  }
  buildComposer(preset);

  const minimap = new Minimap(renderer, scene);
  minimap.setEnabled(preset.minimap);

  // ---------------------------------------------------------------- input
  const input: Input = { f: false, b: false, l: false, r: false, sprint: false, jump: false };
  let flyCam = false;
  const flyPos = new THREE.Vector3(60, GROUND + 50, TERRAIN.plateauZ + 150);

  const keyMap: Record<string, keyof Input> = {
    KeyW: 'f', ArrowUp: 'f',
    KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l',
    KeyD: 'r', ArrowRight: 'r',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    Space: 'jump',
  };

  addEventListener('keydown', (e) => {
    if (ordering.isOpenUI && e.code !== 'Escape') return;
    const k = keyMap[e.code];
    if (k) { input[k] = true; e.preventDefault(); }

    switch (e.code) {
      case 'KeyE':
        if (ordering.canOrder(player.position, sky.hour, sky.dayIndex)) {
          ordering.openOverlay(sky.hour, sky.dayIndex);
        }
        break;
      case 'KeyC': player.toggleView(); crosshair.style.display = player.firstPerson ? 'block' : 'none'; break;
      case 'KeyT': sky.speed = sky.speed > 0 ? 0 : 1.4; break;
      case 'KeyF': flyCam = !flyCam; break;
      case 'F1': applyPreset('Low'); e.preventDefault(); break;
      case 'F2': applyPreset('Medium'); e.preventDefault(); break;
      case 'F3': applyPreset('High'); e.preventDefault(); break;
      case 'KeyM': minimap.setEnabled(!minimap.enabled); break;
      case 'KeyP': logBudgets(); break;
    }
  });
  addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) input[k] = false;
  });

  // Mouse look: pointer lock, GTA-style.
  renderer.domElement.addEventListener('click', () => {
    if (!ordering.isOpenUI) renderer.domElement.requestPointerLock();
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch = Math.max(-0.35, Math.min(1.05, player.pitch + e.movementY * 0.0019));
  });
  addEventListener('wheel', (e) => {
    if (ordering.isOpenUI) return;
    (player as any).armLen = Math.max(2.2, Math.min(9, (player as any).armLen + Math.sign(e.deltaY) * 0.5));
  }, { passive: true });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
  });

  function applyPreset(name: PresetName) {
    preset = PRESETS[name];
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * preset.pixelRatio);
    renderer.shadowMap.enabled = preset.shadows;
    sky.sun.castShadow = preset.shadows;
    sky.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sky.sun.shadow.map?.dispose();
    (sky.sun.shadow as any).map = null;
    for (let i = 0; i < interiorLights.length; i++) {
      interiorLights[i].visible = i < preset.interiorLights;
    }
    minimap.setEnabled(preset.minimap);
    // Rebuild the vineyard at the new instance cap.
    scene.remove(vineyard.group);
    vineyard.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    vineyard = buildVineyard(assets, {
      maxInstances: preset.vineInstances,
      maxDistance: preset.vineDistance,
    });
    scene.add(vineyard.group);
    buildComposer(preset);
    composer?.setSize(innerWidth, innerHeight);
    console.log(`%cpreset%c ${name}`, 'background:#e8d5a8;color:#2a1d12;padding:1px 5px;border-radius:3px', '');
    logBudgets();
  }

  function logBudgets() {
    const r = renderer.info.render;
    const mem = renderer.info.memory;
    console.table({
      preset: { value: preset.name },
      'triangles on screen': { value: r.triangles },
      'draw calls': { value: r.calls },
      'geometries in memory': { value: mem.geometries },
      'textures in memory': { value: mem.textures },
      'vine instances': { value: vineyard.count },
      'static colliders': { value: physics.colliderCount },
      'abbey triangles (static)': { value: built.triangles },
      ...assets.stats(),
    });
  }

  // ---------------------------------------------------------------- loop
  const stats = new Stats();
  await progress(1, 'Ready');
  setTimeout(() => bootEl.classList.add('done'), 160);

  // Failure mode #7: step once with gravity off, THEN enable gravity, so the
  // capsule is resolved against the heightfield before it can tunnel.
  physics.step();
  player.enableGravity();

  let elapsed = 0;
  let firstFrames = 0;

  renderer.setAnimationLoop(() => {
    const dt = stats.tick();
    elapsed += dt;

    physics.step();

    if (flyCam) {
      // Phase 3 inspection camera.
      const sp = (input.sprint ? 55 : 22) * dt;
      const fwd = new THREE.Vector3(
        Math.sin(player.yaw) * Math.cos(player.pitch),
        -Math.sin(player.pitch),
        Math.cos(player.yaw) * Math.cos(player.pitch),
      ).normalize().multiplyScalar(-1);
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
      if (input.f) flyPos.addScaledVector(fwd, sp);
      if (input.b) flyPos.addScaledVector(fwd, -sp);
      if (input.l) flyPos.addScaledVector(right, -sp);
      if (input.r) flyPos.addScaledVector(right, sp);
      if (input.jump) flyPos.y += sp;
      camera.position.copy(flyPos);
      camera.lookAt(flyPos.clone().add(fwd));
      player.object.visible = true;
    } else {
      player.update(dt, input, camera, camColliders);
    }

    sky.update(dt, new THREE.Vector3(LAYOUT.cafe.x - 10, GROUND, LAYOUT.cafe.z - 10));
    vineyard.update(camera.position, elapsed);

    // Scroll the Rhine's normal map.
    const wm = (river as any).__scroll as THREE.MeshStandardMaterial | undefined;
    if (wm?.normalMap) {
      wm.normalMap.offset.set(elapsed * 0.012, elapsed * 0.0055);
    }

    const pPos = player.position;
    ordering.update(dt, pPos, sky.hour, sky.dayIndex, !flyCam);
    minimap.update(dt, flyCam ? camera.position : pPos, player.yaw);

    if (composer) composer.render(dt);
    else renderer.render(scene, camera);

    const r = renderer.info.render;
    stats.extra = {
      tris: r.triangles.toLocaleString(),
      calls: r.calls,
      preset: preset.name,
      time: `${String(Math.floor(sky.hour)).padStart(2, '0')}:${String(Math.floor((sky.hour % 1) * 60)).padStart(2, '0')}`,
      vines: vineyard.count,
    };

    // Log the budget table once the scene has settled.
    if (firstFrames < 120) {
      firstFrames++;
      if (firstFrames === 120) logBudgets();
    }
  });

  // Expose for console poking / the README's verification steps.
  (window as any).hildegard = { scene, renderer, physics, player, menu, assets, logBudgets, sky, applyPreset };

  console.log(
    '%cControls%c  WASD move · Shift sprint · Space jump · Mouse look (click to lock)\n' +
    '  E order at counter · C first/third person · T time-lapse · F fly-cam\n' +
    '  F1/F2/F3 Low/Medium/High · M minimap · P print budgets',
    'background:#e8d5a8;color:#2a1d12;padding:1px 5px;border-radius:3px', '',
  );
}

main().catch((e) => {
  console.error(e);
  bootMsg.innerHTML = `<span style="color:#e08a4a">Boot failed:</span> ${e.message}`;
});
