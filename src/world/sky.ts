import * as THREE from 'three';

/**
 * Day/night cycle. One directional sun is the ONLY shadow-casting light in the
 * scene (hard budget), so its shadow camera is fitted tightly to the abbey
 * plateau rather than the whole 900 m terrain - otherwise 2048px of shadow map
 * spread over 900 m gives useless blocky shadows.
 */
export class Sky {
  sun: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
  /** Hours 0-24. 13.0 = early afternoon, matching the cafe's opening window. */
  hour = 13.0;
  dayIndex = 2; // Tuesday - the cafe is open (Monday is Ruhetag)
  speed = 0;    // hours per second; T ramps this up

  private glazing: THREE.Material[] = [];

  constructor(private scene: THREE.Scene, shadowMapSize: number, shadows: boolean) {
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const d = 120;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun, this.sun.target);

    this.ambient = new THREE.HemisphereLight(0xbcd2f0, 0x53432f, 0.55);
    scene.add(this.ambient);
  }

  /** Register window materials so they can glow after dark. */
  collectGlazing(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && (m as any).__isGlazing && !this.glazing.includes(m)) this.glazing.push(m);
    });
  }

  update(dt: number, focus: THREE.Vector3) {
    this.hour = (this.hour + this.speed * dt) % 24;

    // Sun elevation: peaks at noon, below horizon before 6 and after 20.
    const t = (this.hour - 6) / 14;           // 0 at 06:00, 1 at 20:00
    const elev = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
    const azim = (this.hour / 24) * Math.PI * 2 - Math.PI / 2;

    const dist = 190;
    // South-facing slope: keep the sun arcing over the river side.
    this.sun.position.set(
      focus.x + Math.cos(azim) * dist * 0.8,
      focus.y + Math.max(6, elev * dist),
      focus.z + Math.sin(azim) * dist * 0.5 + 40,
    );
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    const night = elev <= 0.02;
    const warm = Math.max(0, 1 - Math.abs(this.hour - 13) / 7);

    this.sun.intensity = night ? 0 : 0.5 + elev * 2.3;
    this.sun.color.setHSL(0.09 + warm * 0.02, 0.45 - elev * 0.28, 0.62 + elev * 0.2);

    this.ambient.intensity = night ? 0.12 : 0.28 + elev * 0.45;
    this.ambient.color.setHSL(0.58, 0.35, night ? 0.22 : 0.55 + elev * 0.15);
    this.ambient.groundColor.setHSL(0.09, 0.3, night ? 0.06 : 0.2);

    // HDRI background brightness follows the sun so night is not a bright blue sky.
    this.scene.backgroundIntensity = night ? 0.06 : 0.25 + elev * 0.85;
    if (this.scene.fog instanceof THREE.Fog) {
      const f = this.scene.fog;
      f.color.setHSL(0.58, night ? 0.25 : 0.2, night ? 0.05 : 0.42 + elev * 0.3);
    }
    this.scene.environmentIntensity = night ? 0.1 : 0.45 + elev * 0.6;

    // Windows glow once the sun is down.
    const glow = night ? 1 : Math.max(0, 1 - elev * 5);
    for (const m of this.glazing) {
      (m as THREE.MeshStandardMaterial).emissiveIntensity = glow * 1.6;
    }
  }

  get isNight() { return this.hour < 6.2 || this.hour > 19.9; }
}
