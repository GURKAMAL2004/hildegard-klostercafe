export type PresetName = 'Low' | 'Medium' | 'High';

export interface Preset {
  name: PresetName;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  ssao: boolean;       // off on Low AND Medium - integrated GPUs collapse under it
  bloom: boolean;
  smaa: boolean;
  vineDistance: number;   // metres; rows beyond this are culled
  vineInstances: number;  // hard cap on instanced vines
  interiorLights: number;
  waterDetail: boolean;
  minimap: boolean;
}

export const PRESETS: Record<PresetName, Preset> = {
  Low: {
    name: 'Low',
    pixelRatio: 0.75,
    shadows: false,
    shadowMapSize: 1024,
    ssao: false,
    bloom: false,
    smaa: false,
    vineDistance: 90,
    vineInstances: 1800,
    interiorLights: 2,
    waterDetail: false,
    minimap: false,
  },
  Medium: {
    name: 'Medium',
    pixelRatio: 1.0,
    shadows: true,
    shadowMapSize: 2048,
    ssao: false,
    bloom: true,
    smaa: true,
    vineDistance: 150,
    vineInstances: 4200,
    interiorLights: 4,
    waterDetail: true,
    minimap: true,
  },
  High: {
    name: 'High',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 2048, // budget caps us at one 2048 shadow map, even on High
    ssao: true,
    bloom: true,
    smaa: true,
    vineDistance: 220,
    vineInstances: 6000,
    interiorLights: 6,
    waterDetail: true,
    minimap: true,
  },
};

export function detectDefault(): PresetName {
  const mem = (navigator as any).deviceMemory ?? (performance as any).memory;
  const cores = navigator.hardwareConcurrency ?? 4;
  // This project targets a 6 GB / integrated-GPU machine, so Medium is the ceiling
  // we auto-select; High must be chosen deliberately with F3.
  if (cores <= 4) return 'Low';
  return 'Medium';
}
