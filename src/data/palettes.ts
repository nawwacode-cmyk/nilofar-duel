import { C } from '../core/util';
import type { Palette } from '../core/types';

// HDR colours (>1) so bloom picks them up. Index 0/1 = body, 2 = hot core.
export const FIRE: Palette = [C(3, 1.1, 0.25), C(2.6, 0.55, 0.1), C(3, 2, 0.7)];
export const ICE: Palette = [C(0.5, 1.3, 3), C(0.25, 0.75, 2.6), C(1.8, 2.6, 3)];
export const SHADOW: Palette = [C(1.6, 0.4, 2.6), C(0.9, 0.2, 2), C(2.4, 1.4, 3)];
export const LIGHT: Palette = [C(2.6, 2.6, 1.2), C(1.4, 1.8, 3), C(3, 3, 2.4)];
/** Ehab: molten gold with a white-hot core. */
export const ARCH: Palette = [C(3, 2.1, 0.6), C(2.4, 1.4, 0.25), C(3, 2.8, 1.8)];
export const GOLD: Palette = [C(2.6, 2, 0.7)];
export const WHITE: Palette = [C(3, 3, 3)];
/** Sara: violet petals with a pink-white heart. */
export const FLORA: Palette = [C(2.2, 0.7, 2.6), C(1.5, 0.35, 2.2), C(3, 2, 2.8)];
/** Abed: cold sky-blue wind with a white core. */
export const WIND: Palette = [C(0.8, 1.9, 3), C(0.35, 1.1, 2.6), C(2.4, 2.8, 3)];
