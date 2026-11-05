import { describe, it, expect } from 'vitest';
import { ROSTER, FAIR, skillLabel } from '../src/data/roster';
import { G, PSPEC, DMG, AI_LEVELS } from '../src/data/rules';
import { TXT } from '../src/data/text';

describe('roster', () => {
  it('has the five wizards with their own spells and skills', () => {
    expect(ROSTER.map(r => [r.id, r.bolt.kind, r.spec, r.skill.k])).toEqual([
      ['reem', 'fire', 'meteor', 'portal'],
      ['siraj', 'ice', 'spears', 'wall'],
      ['layla', 'shadow', 'curse', 'clones'],
      ['qasem', 'spark', 'thunder', 'blink'],
      ['ehab', 'gold', 'orbs', 'veil'],
    ]);
  });
  it('is fair: same health, speed, dodge, attack cadence and skill cost for everyone', () => {
    for (const r of ROSTER) {
      expect([r.hp, r.speed, r.dodgeCost, r.bolt.cd, r.skill.cost, r.skill.cd]).toEqual([FAIR.hp, FAIR.speed, FAIR.dodgeCost, FAIR.boltCd, FAIR.skill.cost, FAIR.skill.cd]);
    }
  });
  it('is fair: every basic bolt hits the same (damage, speed, size, power, no extra effects)', () => {
    const specs = ROSTER.map(r => PSPEC[r.bolt.kind]);
    for (const s of specs) expect([s.dmg, s.sp, s.r, s.pw, s.slow, s.home]).toEqual([specs[0].dmg, specs[0].sp, specs[0].r, specs[0].pw, undefined, undefined]);
  });
  it('is fair: every special deals 30 when it connects', () => {
    expect(PSPEC.meteor.dmg).toBe(30);
    expect(PSPEC.curse.dmg).toBe(30);
    expect(DMG.thunder).toBe(30);
    expect(PSPEC.spear.dmg * 2).toBe(30); // three spread spears, two land at most
    expect(PSPEC.orb.dmg * 5).toBe(30); // five orbs
    for (const k of ['meteor', 'spear', 'curse', 'orb'] as const) { expect(PSPEC[k].pw).toBe(2); expect(PSPEC[k].slow).toBeUndefined(); }
  });
  it('every skill is affordable from a full mana bar', () => {
    for (const r of ROSTER) expect(r.skill.cost).toBeLessThanOrEqual(100);
    expect(G.spCost).toBeLessThanOrEqual(100);
  });
  it('every basic bolt kind has a projectile spec', () => {
    for (const r of ROSTER) expect(PSPEC[r.bolt.kind]).toBeDefined();
  });
  it('skill button labels are single words', () => {
    expect(ROSTER.map(skillLabel)).toEqual(['بوابة', 'جدار', 'نُسخ', 'ومضة', 'حجاب']);
  });
});

describe('rules', () => {
  it('keeps the original combat constants', () => {
    expect(G).toMatchObject({ boltCost: 6, spCost: 55, dodgeCd: 0.8, regen: 13, shieldDrain: 14, parryWin: 0.22, shMax: 1.5, shCd: 3, shHP: 40, strugCd: 7 });
    expect(DMG).toMatchObject({ thunder: 30, struggleWin: 42, struggleDraw: 15, aoe: 15 });
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
