import { C } from '../core/util';
import type { Palette } from '../core/types';

// HDR colours (>1) so bloom picks them up. Index 0/1 = body, 2 = hot core.
export const FIRE: Palette = [C(3, 1.1, 0.25), C(2.6, 0.55, 0.1), C(3, 2, 0.7)];
export const ICE: Palette = [C(0.5, 1.3, 3), C(0.25, 0.75, 2.6), C(1.8, 2.6, 3)];
export const SHADOW: Palette = [C(1.6, 0.4, 2.6), C(0.9, 0.2, 2), C(2.4, 1.4, 3)];
export const LIGHT: Palette = [C(2.6, 2.6, 1.2), C(1.4, 1.8, 3), C(3, 3, 2.4)];
export const GOLD: Palette = [C(2.6, 2, 0.7)];
export const WHITE: Palette = [C(3, 3, 3)];
