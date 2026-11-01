import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface TexMaps { diff?: string; nor?: string; arm?: string; rough?: string }
export interface Manifest {
  textures: Record<string, { source: string; license: string; maps: TexMaps }>;
  hdri: { file: string; id: string; source: string } | null;
}

/**
 * Loads textures once and caches both textures and materials by key.
 * Guards against the classic RAM blowup of re-loading the same map per mesh.
 */
export class Assets {
  private texCache = new Map<string, THREE.Texture>();
  private matCache = new Map<string, THREE.Material>();
  private loader = new THREE.TextureLoader();
  manifest!: Manifest;
  envMap: THREE.Texture | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {}

  async loadManifest() {
    const r = await fetch('textures/manifest.json');
    if (!r.ok) throw new Error('textures/manifest.json missing - run: npm run fetch:textures');
    this.manifest = await r.json();
  }

  /** Shared anisotropy ceiling; iGPUs choke above 4. */
  private aniso = 4;

  private tex(file: string, srgb: boolean, repeat: number): THREE.Texture {
    const key = `${file}|${srgb}|${repeat}`;
    const hit = this.texCache.get(key);
    if (hit) return hit;
    const t = this.loader.load(`textures/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    this.texCache.set(key, t);
    return t;
  }

  /**
   * Build (or reuse) a PBR material from a manifest entry.
   * `arm` maps pack AO=R, Roughness=G, Metalness=B - three.js can read all three
   * from the same texture, which is why we fetched arm instead of 3 separate maps.
   */
  material(
    name: string,
    opts: { repeat?: number; color?: number; roughness?: number; side?: THREE.Side } = {},
  ): THREE.MeshStandardMaterial {
    const repeat = opts.repeat ?? 1;
    const key = `${name}|${repeat}|${opts.color ?? 'x'}|${opts.roughness ?? 'x'}|${opts.side ?? 0}`;
    const hit = this.matCache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;

    const entry = this.manifest.textures[name];
    const m = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 0.85,
      metalness: 0,
      side: opts.side ?? THREE.FrontSide,
    });

    if (entry) {
      const { maps } = entry;
      if (maps.diff) m.map = this.tex(maps.diff, true, repeat);
      if (maps.nor) {
        m.normalMap = this.tex(maps.nor, false, repeat);
        m.normalScale.set(0.8, 0.8);
      }
      if (maps.arm) {
        const arm = this.tex(maps.arm, false, repeat);
        m.aoMap = arm;
        m.roughnessMap = arm;
        m.metalnessMap = arm;
        m.aoMapIntensity = 0.75;
      } else if (maps.rough) {
        m.roughnessMap = this.tex(maps.rough, false, repeat);
      }
    } else {
      // Unknown name - leave an obvious flat colour rather than silently shipping white.
      m.color.setHex(opts.color ?? 0x8a7f72);
    }

    this.matCache.set(key, m);
    return m;
  }

  /** Plain (untextured) material, still deduped. */
  plain(color: number, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
    const key = `plain|${color}|${roughness}|${metalness}`;
    const hit = this.matCache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.matCache.set(key, m);
    return m;
  }

  async loadHDRI(scene: THREE.Scene): Promise<void> {
    if (!this.manifest.hdri) return;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const hdr = await new RGBELoader().loadAsync(`hdri/${this.manifest.hdri.file}`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(hdr).texture;
    this.envMap = env;
    scene.environment = env;
    scene.background = env;
    scene.backgroundIntensity = 1.0;
    hdr.dispose();
    pmrem.dispose();
  }

  /** Report for the Phase 8 budget table. */
  stats() {
    return { textures: this.texCache.size, materials: this.matCache.size };
  }

  dispose() {
    for (const t of this.texCache.values()) t.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.texCache.clear();
    this.matCache.clear();
    this.envMap?.dispose();
  }
}
