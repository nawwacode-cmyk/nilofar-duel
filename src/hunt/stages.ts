import type { MonId } from './monsters';
import type { SceneId } from './script';

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
  /** Walkable only within `walkPad` metres of these (detailed ground) materials; the rest is scenery. */
  walkOn?: string[]; walkPad?: number;
  /** Materials dithered away when they come between the camera and the wizard (trees, branches, bushes). */
  cutaway?: string[];
  objective: string;
  groups: SpawnGroup[];
  /** Waves: each starts when the previous one is all dead; the gate appears after the last (village). */
  waves?: SpawnGroup[][];
  /** The stage's boss and where it waits; the stage ends when it falls (no gate). */
  boss?: { id: MonId; at: [number, number] };
  /** Story scene when the stage starts, and when it is completed. */
  intro?: SceneId; end: SceneId;
  /** Spoken (during play) when a given wave starts, e.g. the mill's warden. */
  waveSay?: Record<number, SceneId>;
  /** The stage after this one (none: the journey ends). */
  next?: StageId;
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
    cutaway: ['Background_Tree_Atlas', 'Trunk_Birch', 'Trunk_Oak', 'Forest_Bush', 'Grass_Vegetation_Dry', 'Grass_Vegetation_Green', 'Grass_Close', 'Wood_Log'],
    walkOn: ['Dirt_Road', 'Dirt_Road_Bare', 'Dirt_Road_Trails', 'Road_Edge_Gravel_Dusty', 'Puddle_Streaks', 'Mud_Pile', 'Cobblestone', 'Ground_Dirt', 'Fallen_Generic_Leaves', 'Fallen_Maple_Leaves', 'Rock_Decal'], walkPad: 1.5,
    objective: 'اعبُر الغابة إلى البوابة',
    intro: 'intro', end: 'forestEnd', next: 'village',
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
  // A walled farm (about 30 × 33 m): the cobbled path enters from the south (+z) and ends at the mill (north).
  village: {
    name: 'القرية الملعونة', map: 'village', start: [-0.8, 12.5], startYaw: Math.PI, gate: [3.5, -8.5], paths: [],
    cutaway: ['Leaf', 'Thatched', 'scarecrow', 'Tool'],
    objective: 'طهِّر القرية', intro: 'villageIntro', end: 'villageEnd', next: 'swamp',
    groups: [],
    waves: [
      [{ at: [-4, 4], m: ['villager'] }, { at: [3, 2], m: ['villager'] }, { at: [6, 8], m: ['villager'] }, { at: [-6, -2], m: ['villager'] }, { at: [-7, 6], m: ['parasite'] }],
      [{ at: [0, -2], m: ['villager'], rise: true }, { at: [5, 5], m: ['villager'], rise: true }, { at: [-5, 8], m: ['villager'], rise: true }, { at: [7, -5], m: ['villager'], rise: true }, { at: [-3, -6], m: ['parasite', 'parasite'] }],
      [{ at: [5, -9], m: ['warden'] }],
    ],
    waveSay: { 2: 'warden' },
    env: { sun: [-30, 25, 20], sunColor: 0xffb070, sunI: 1.8, hemi: [0x7080a8, 0x221a12, 1], sky: ['#1d2238', '#8a6050'], fog: [40, 160], exposure: 1.0 },
  },
  // A small swamp around a shack (about 22 × 22 m); the boss waits on the far (north) side.
  swamp: {
    name: 'المستنقع', map: 'swamp', start: [0, 9], startYaw: Math.PI, gate: [0, 0], paths: [],
    cutaway: ['Bark', 'Foliage_DeadGrass'],
    objective: 'اهزم الموء', intro: 'bossIntro', end: 'victory',
    groups: [], boss: { id: 'mutant', at: [0, -7] },
    env: { sun: [-20, 30, 10], sunColor: 0xb0c4ff, sunI: 1.9, hemi: [0x6a7ca8, 0x181c14, 1.45], sky: ['#0c1020', '#304050'], fog: [25, 110], exposure: 1.3 },
  },
};
