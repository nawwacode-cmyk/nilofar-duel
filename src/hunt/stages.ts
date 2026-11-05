import type { MonId } from './monsters';

/**
 * Stages of «رحلة الصيّادين». Coordinates are metres in the stage's own space (as written by tools/slim-map.mjs):
 * where the hunters start, the gate that ends the stage, and the monster groups along the way.
 */
export type StageId = 'forest' | 'village' | 'swamp';

export interface SpawnGroup {
  at: [number, number];
  /** Monster types of the group (one entry per monster). */
  m: MonId[];
  /** Only sometimes there (rare monsters): chance 0..1. */
  chance?: number;
  /** Rise from the ground when the player comes near instead of waiting in place. */
  rise?: boolean;
}

export interface StageDef {
  name: string;
  map: string;
  start: [number, number]; startYaw: number;
  gate: [number, number];
  /** The route (polylines along the road): drawn on the corner map; with `corridor` set, the walkable area is
   *  limited to that many metres around it, so the stage is a journey rather than an open field. */
  paths: [number, number][][]; corridor?: number;
  objective: string;
  groups: SpawnGroup[];
  /** Light and sky: sun direction/colour/intensity, ambient sky/ground, sky gradient top→horizon, fog near/far. */
  env: { sun: [number, number, number]; sunColor: number; sunI: number; hemi: [number, number, number]; sky: [string, string]; fog: [number, number]; exposure: number };
}

export const STAGES: Record<StageId, StageDef> = {
  forest: {
    name: 'غابة الأرواح', map: 'forest',
    start: [-107, -47], startYaw: 2.53,
    gate: [-15, 77],
    // The dirt road (read from the map's Dirt_Road surface): north-west end → east loop → back west → fork → gate.
    paths: [
      [[-109, -45], [-100, -57.5], [-82.5, -71], [-62.5, -77.5], [-40, -77.5], [-20, -70], [-7.5, -60], [1, -47.5], [7.5, -32.5], [22.5, -18], [37.5, -20], [52.5, -40], [70, -45], [85, -35], [92.5, -15], [102.5, 2.5], [108, 20], [102.5, 34], [80, 35], [55, 35], [30, 34], [5, 32.5], [0, 45], [-8, 62], [-15, 77]],
      [[50, 38], [30, 44], [10, 56], [-8, 68], [-15, 77]],
    ],
    corridor: 8,
    objective: 'اعبُر الغابة إلى البوابة',
    groups: [
      { at: [-85, -70], m: ['wolf', 'wolf'] },
      { at: [-45, -77], m: ['skeleton', 'skeleton', 'skeleton'], rise: true },
      { at: [-5, -57], m: ['spider'] },
      { at: [20, -18], m: ['wolf', 'wolf', 'wolf'] },
      { at: [52, -40], m: ['skeleton', 'skeleton', 'wolf'], rise: true },
      { at: [88, -26], m: ['spider', 'skeleton'] },
      { at: [105, 12], m: ['ghost'], chance: 0.6 },
      { at: [100, 30], m: ['wolf', 'wolf'] },
      { at: [65, 35], m: ['wolf', 'wolf', 'wolf', 'wolf'] },
      { at: [30, 36], m: ['greatwolf'], chance: 0.35 },
      { at: [5, 34], m: ['skeleton', 'skeleton'], rise: true },
      { at: [-6, 64], m: ['spider', 'skeleton', 'skeleton'] },
    ],
    env: { sun: [-40, 30, 25], sunColor: 0xffc890, sunI: 2.2, hemi: [0x8aa0c8, 0x2a2418, 1.1], sky: ['#2a3550', '#c99a6a'], fog: [60, 240], exposure: 1.0 },
  },
  village: {
    name: 'القرية الملعونة', map: 'village', start: [0, -20], startYaw: 0, gate: [0, 20], paths: [], objective: 'طهِّر القرية', groups: [],
    env: { sun: [-30, 25, 20], sunColor: 0xffb070, sunI: 1.8, hemi: [0x7080a8, 0x221a12, 1], sky: ['#1d2238', '#8a6050'], fog: [40, 160], exposure: 1.0 },
  },
  swamp: {
    name: 'المستنقع', map: 'swamp', start: [0, -10], startYaw: 0, gate: [0, 0], paths: [], objective: 'اهزم الموء', groups: [],
    env: { sun: [-20, 30, 10], sunColor: 0xa0b8ff, sunI: 1.2, hemi: [0x506080, 0x101410, 1], sky: ['#0c1020', '#304050'], fog: [25, 110], exposure: 1.05 },
  },
};
