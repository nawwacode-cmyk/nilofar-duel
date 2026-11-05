import type { WizardDef } from '../core/types';
import { FIRE, ICE, SHADOW, LIGHT, ARCH } from './palettes';

/**
 * The wizards. Fair like Mortal Kombat: every wizard has the same health, speed, dodge cost, attack cadence
 * and skill cost/cooldown, and every hit of the same type deals the same damage (see PSPEC). They differ only in
 * how their spells behave, so duels are won by skill and reading the opponent. Text is Modern Standard Arabic.
 */
export const FAIR = { hp: 250, speed: 2.9, dodgeCost: 12, boltCd: 0.4, skill: { cost: 25, cd: 8 } } as const;
export const ROSTER: readonly WizardDef[] = [
  {
    id: 'reem', icon: 'local_fire_department', name: 'ريم', female: true, file: 'arissa', elem: 'ساحرة النار',
    hp: FAIR.hp, speed: FAIR.speed, pal: FIRE, css: '#ffb347', lc: 0xff8a3d,
    bolt: { kind: 'fire', cd: FAIR.boltCd }, spec: 'meteor', dodgeCost: FAIR.dodgeCost,
    snd: 'fire', cs: 'm_fire_cast', ss: 'm_fire_swoosh', stat: [3, 3, 3],
    story: 'ابنة حدّادٍ من قريةٍ جبلية، تعلّمت ترويض النار في فرن أبيها قبل أن تلتحق بأكاديمية النيلوفر. احترقت قريتها في ليلةٍ لا يتحدّث عنها أحد، ومنذ ذلك الحين تقاتل لتستعيد ما سُلب منها. لا تنتظر خصمها، بل تفتح بوابةً من لهب وتظهر حيث لا يتوقّعها أحد.',
    ab: [
      ['هجوم', 'شرارة النار', 'كرة لهب تترك أثرًا مشتعلًا'],
      ['خاصة', 'النيزك', 'كرة نارية ضخمة تنفجر وتحرق كل ما حولها'],
      ['مهارة', 'بوابة اللهب', 'تختفي في بوابة لتظهر من أخرى خلف خصمها'],
    ],
    skill: { k: 'portal', ...FAIR.skill },
  },
  {
    id: 'siraj', icon: 'ac_unit', name: 'سراج', female: false, file: 'ganfaul', elem: 'ساحر الجليد',
    hp: FAIR.hp, speed: FAIR.speed, pal: ICE, css: '#a9e4ff', lc: 0x6fc6ff,
    bolt: { kind: 'ice', cd: FAIR.boltCd }, spec: 'spears', dodgeCost: FAIR.dodgeCost,
    snd: 'ice', cs: 'm_ice_thin', ss: 'm_ice', stat: [3, 3, 3],
    story: 'أقدم حرّاس الأكاديمية. قضى شتاءً طويلًا وحيدًا على قمّة جبلٍ متجمّد، فعاد أبيض الشعر بارد القلب. لا يستعجل أبدًا؛ كل ضربةٍ منه تُبرّد عروق خصمه، وإذا أحسّ بالخطر رفع جدارًا من الجليد لا يخترقه شيء.',
    ab: [
      ['هجوم', 'شظية الجليد', 'شظية حادّة من الجليد الأزرق'],
      ['خاصة', 'رماح الجليد', 'ثلاثة رماح تتفرّق فتغلق طرق الهرب'],
      ['مهارة', 'جدار الجليد', 'جدار يصدّ كل التعاويذ خمس ثوانٍ'],
    ],
    skill: { k: 'wall', ...FAIR.skill },
  },
  {
    id: 'layla', icon: 'dark_mode', name: 'ليلى', female: true, file: 'nightshade', elem: 'ساحرة الظل',
    hp: FAIR.hp, speed: FAIR.speed, pal: SHADOW, css: '#d49bff', lc: 0xb46bff,
    bolt: { kind: 'shadow', cd: FAIR.boltCd }, spec: 'curse', dodgeCost: FAIR.dodgeCost,
    snd: 'shadow', cs: 'm_fastmagic', ss: 'm_arcane', stat: [3, 3, 3],
    story: 'لا يعرف أحدٌ من أين جاءت. يُقال إنها تعلّمت السحر من ظلّها في ليلةٍ بلا قمر. هي أسرع السحرة في الساحة وأخفّهم، ومن يحاول الإمساك بها يجد نفسه يقاتل الظلال.',
    ab: [
      ['هجوم', 'كرة الظل', 'كرة ظلٍّ تلتفّ في طريقها'],
      ['خاصة', 'اللعنة المُلاحِقة', 'كرة تتبع خصمها أينما ذهب'],
      ['مهارة', 'نُسخ الظل', 'نسختان منها تتحرّكان وتهاجمان وتُشتّتان الخصم'],
    ],
    skill: { k: 'clones', ...FAIR.skill },
  },
  {
    id: 'qasem', icon: 'bolt', name: 'قاسم', female: false, file: 'pelegrini', elem: 'ساحر البرق',
    hp: FAIR.hp, speed: FAIR.speed, pal: LIGHT, css: '#fff3a0', lc: 0xfff0a0,
    bolt: { kind: 'spark', cd: FAIR.boltCd }, spec: 'thunder', dodgeCost: FAIR.dodgeCost,
    snd: 'bolt', cs: 'm_shock', ss: 'm_cast_long', stat: [3, 3, 3],
    story: 'كان فارسًا في جيش الملك حتى أصابته صاعقةٌ في منتصف معركة وتركته حيًّا. ومنذ ذلك اليوم يسري البرق في عروقه. ترك سيفه واختار العصا، فصار يتنقّل بومضة ويُنزل غضب السماء على أعدائه.',
    ab: [
      ['هجوم', 'شرارة البرق', 'شرارة ممدودة كالسهم'],
      ['خاصة', 'صاعقة السماء', 'تهبط مكان خصمه بعد لحظة، ما لم يفرّ'],
      ['مهارة', 'ومضة البرق', 'ينتقل فورًا أربعة أمتار ولا يصيبه شيء أثناءها'],
    ],
    skill: { k: 'blink', ...FAIR.skill },
  },
  {
    id: 'ehab', icon: 'auto_awesome', name: 'إيهاب', female: false, file: 'ehab', rig: 'tripo', elem: 'كبير السحرة',
    hp: FAIR.hp, speed: FAIR.speed, pal: ARCH, css: '#f0c46a', lc: 0xffc860,
    bolt: { kind: 'gold', cd: FAIR.boltCd }, spec: 'orbs', dodgeCost: FAIR.dodgeCost,
    snd: 'shadow', cs: 'm_light', ss: 'm_epic', stat: [3, 3, 3],
    story: 'كبير السحرة وأقوى من حمل عصًا في تاريخ أكاديمية النيلوفر. جمع أسرار النار والجليد والظل والبرق، ثم تجاوزها جميعًا إلى سحرٍ ذهبيٍّ لا يعرف أحدٌ أصله. لا يُرى إلا حين يريد أن يُرى؛ فالخداع عنده فنٌّ قبل أن يكون سلاحًا، ومن يظنّ أنه يقاتله يكتشف أنه كان يقاتل وهمًا.',
    ab: [
      ['هجوم', 'سهم الذهب', 'سهمٌ من نورٍ ذهبيّ'],
      ['خاصة', 'حكم الذهب', 'خمس كرات ذهبية تنتشر ثم تلاحق الخصم'],
      ['مهارة', 'حجاب الخداع', 'يختفي عن الأنظار ويترك وهمًا مكانه'],
    ],
    skill: { k: 'veil', ...FAIR.skill },
    // The archmage's extra ability (owner's request): a ring of illusions that holds the opponent, then strikes.
    skill2: { k: 'army', cost: 40, cd: 14 },
    ab2: ['قدرة', 'جيش الأوهام', 'تتكاثر أوهامه حول خصمه فتشلّه لحظة ثم تنقضّ عليه'],
  },
];

/** Short label for the skill button, e.g. "بوابة". */
export const skillLabel = (w: WizardDef) => w.ab[2][1].split(' ')[0];
