import { describe, it, expect } from 'vitest';
import { ROSTER, skillLabel } from '../src/data/roster';
import { G, PSPEC, DMG, AI_LEVELS } from '../src/data/rules';
import { TXT } from '../src/data/text';

describe('roster', () => {
  it('has the four original wizards with their original balance numbers', () => {
    expect(ROSTER.map(r => [r.id, r.hp, r.speed, r.bolt.kind, r.bolt.cd, r.spec, r.dodgeCost, r.skill.k, r.skill.cost, r.skill.cd])).toEqual([
      ['reem', 240, 2.9, 'fire', 0.42, 'meteor', 14, 'portal', 25, 7],
      ['siraj', 290, 2.5, 'ice', 0.45, 'spears', 14, 'wall', 30, 9],
      ['layla', 210, 3.4, 'shadow', 0.33, 'curse', 9, 'clones', 35, 10],
      ['qasem', 255, 2.8, 'spark', 0.38, 'thunder', 14, 'blink', 15, 4],
    ]);
  });
  it('every skill is affordable from a full mana bar', () => {
    for (const r of ROSTER) expect(r.skill.cost).toBeLessThanOrEqual(100);
    expect(G.spCost).toBeLessThanOrEqual(100);
  });
  it('every basic bolt kind has a projectile spec', () => {
    for (const r of ROSTER) expect(PSPEC[r.bolt.kind]).toBeDefined();
  });
  it('skill button labels are single words', () => {
    expect(ROSTER.map(skillLabel)).toEqual(['بوابة', 'جدار', 'نُسخ', 'ومضة']);
  });
});

describe('rules', () => {
  it('keeps the original combat constants', () => {
    expect(G).toMatchObject({ boltCost: 6, spCost: 55, dodgeCd: 0.8, regen: 13, shieldDrain: 14, parryWin: 0.22, shMax: 1.5, shCd: 3, shHP: 40, strugCd: 7 });
    expect(DMG).toMatchObject({ thunder: 36, struggleWin: 42, struggleDraw: 15, aoe: 20 });
  });
  it('AI difficulty increases monotonically', () => {
    for (let i = 1; i < AI_LEVELS.length; i++) {
      expect(AI_LEVELS[i].rate).toBeGreaterThan(AI_LEVELS[i - 1].rate);
      expect(AI_LEVELS[i].react).toBeLessThan(AI_LEVELS[i - 1].react);
    }
  });
});

describe('text', () => {
  it('conjugates verbs by wizard gender', () => {
    expect(TXT.endTitle(ROSTER[0])).toBe('ريم فازت!');
    expect(TXT.endTitle(ROSTER[1])).toBe('سراج فاز!');
    expect(TXT.roundWon(ROSTER[2])).toBe('ليلى حسمت الجولة');
  });
});
