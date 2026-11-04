import type { WizardDef } from '../core/types';
import { FIRE, ICE, SHADOW, LIGHT, ARCH } from './palettes';

/** The wizards. Numbers are balance-critical; text is Modern Standard Arabic. */
export const ROSTER: readonly WizardDef[] = [
  {
    id: 'reem', icon: 'local_fire_department', name: 'ريم', female: true, file: 'arissa', elem: 'ساحرة النار',
    hp: 240, speed: 2.9, pal: FIRE, css: '#ffb347', lc: 0xff8a3d,
    bolt: { kind: 'fire', cd: 0.42 }, spec: 'meteor', dodgeCost: 14,
    snd: 'fire', cs: 'm_fire_cast', ss: 'm_fire_swoosh', stat: [3, 3, 4],
    story: 'ابنة حدّادٍ من قريةٍ جبلية، تعلّمت ترويض النار في فرن أبيها قبل أن تلتحق بأكاديمية النيلوفر. احترقت قريتها في ليلةٍ لا يتحدّث عنها أحد، ومنذ ذلك الحين تقاتل لتستعيد ما سُلب منها. لا تنتظر خصمها، بل تفتح بوابةً من لهب وتظهر حيث لا يتوقّعها أحد.',
    ab: [
      ['هجوم', 'شرارة النار', 'ضربة سريعة متوسطة القوة'],
      ['خاصة', 'النيزك', 'كرة نارية ضخمة تنفجر وتحرق كل ما حولها'],
      ['مهارة', 'بوابة اللهب', 'تختفي في بوابة لتظهر من أخرى خلف خصمها'],
    ],
    skill: { k: 'portal', cost: 25, cd: 7 },
  },
  {
    id: 'siraj', icon: 'ac_unit', name: 'سراج', female: false, file: 'ganfaul', elem: 'ساحر الجليد',
    hp: 290, speed: 2.5, pal: ICE, css: '#a9e4ff', lc: 0x6fc6ff,
    bolt: { kind: 'ice', cd: 0.45 }, spec: 'spears', dodgeCost: 14,
    snd: 'ice', cs: 'm_ice_thin', ss: 'm_ice', stat: [5, 2, 3],
    story: 'أقدم حرّاس الأكاديمية. قضى شتاءً طويلًا وحيدًا على قمّة جبلٍ متجمّد، فعاد أبيض الشعر بارد القلب. لا يستعجل أبدًا؛ كل ضربةٍ منه تُبرّد عروق خصمه، وإذا أحسّ بالخطر رفع جدارًا من الجليد لا يخترقه شيء.',
    ab: [
      ['هجوم', 'شظية الجليد', 'تُبطئ خصمك قليلًا مع كل إصابة'],
      ['خاصة', 'رماح الجليد', 'ثلاثة رماح تتفرّق وتجمّد من تصيبه'],
      ['مهارة', 'جدار الجليد', 'جدار يصدّ كل التعاويذ خمس ثوانٍ'],
    ],
    skill: { k: 'wall', cost: 30, cd: 9 },
  },
  {
    id: 'layla', icon: 'dark_mode', name: 'ليلى', female: true, file: 'nightshade', elem: 'ساحرة الظل',
    hp: 210, speed: 3.4, pal: SHADOW, css: '#d49bff', lc: 0xb46bff,
    bolt: { kind: 'shadow', cd: 0.33 }, spec: 'curse', dodgeCost: 9,
    snd: 'shadow', cs: 'm_fastmagic', ss: 'm_arcane', stat: [2, 5, 3],
    story: 'لا يعرف أحدٌ من أين جاءت. يُقال إنها تعلّمت السحر من ظلّها في ليلةٍ بلا قمر. هي أسرع السحرة في الساحة وأخفّهم، ومن يحاول الإمساك بها يجد نفسه يقاتل الظلال.',
    ab: [
      ['هجوم', 'كرة الظل', 'أسرع ضربة بين السحرة'],
      ['خاصة', 'اللعنة المُلاحِقة', 'كرة تتبع خصمها أينما ذهب'],
      ['مهارة', 'نُسخ الظل', 'نسختان منها تتحرّكان وتهاجمان وتُشتّتان الخصم'],
    ],
    skill: { k: 'clones', cost: 35, cd: 10 },
  },
  {
    id: 'qasem', icon: 'bolt', name: 'قاسم', female: false, file: 'pelegrini', elem: 'ساحر البرق',
    hp: 255, speed: 2.8, pal: LIGHT, css: '#fff3a0', lc: 0xfff0a0,
    bolt: { kind: 'spark', cd: 0.38 }, spec: 'thunder', dodgeCost: 14,
    snd: 'bolt', cs: 'm_shock', ss: 'm_cast_long', stat: [3, 3, 4],
    story: 'كان فارسًا في جيش الملك حتى أصابته صاعقةٌ في منتصف معركة وتركته حيًّا. ومنذ ذلك اليوم يسري البرق في عروقه. ترك سيفه واختار العصا، فصار يتنقّل بومضة ويُنزل غضب السماء على أعدائه.',
    ab: [
      ['هجوم', 'شرارة البرق', 'أسرع تعويذة في الساحة، يصعب تفاديها'],
      ['خاصة', 'صاعقة السماء', 'تهبط مكان خصمه بعد لحظة، ما لم يفرّ'],
      ['مهارة', 'ومضة البرق', 'ينتقل فورًا أربعة أمتار ولا يصيبه شيء أثناءها'],
    ],
    skill: { k: 'blink', cost: 15, cd: 4 },
  },
  {
    id: 'ehab', icon: 'auto_awesome', name: 'إيهاب', female: false, file: 'ehab', rig: 'tripo', elem: 'كبير السحرة',
    hp: 300, speed: 3.0, pal: ARCH, css: '#f0c46a', lc: 0xffc860,
    bolt: { kind: 'gold', cd: 0.36 }, spec: 'orbs', dodgeCost: 11,
    snd: 'shadow', cs: 'm_light', ss: 'm_epic', stat: [5, 4, 5],
    story: 'كبير السحرة وأقوى من حمل عصًا في تاريخ أكاديمية النيلوفر. جمع أسرار النار والجليد والظل والبرق، ثم تجاوزها جميعًا إلى سحرٍ ذهبيٍّ لا يعرف أحدٌ أصله. لا يُرى إلا حين يريد أن يُرى؛ فالخداع عنده فنٌّ قبل أن يكون سلاحًا، ومن يظنّ أنه يقاتله يكتشف أنه كان يقاتل وهمًا.',
    ab: [
      ['هجوم', 'سهم الذهب', 'تعويذة سريعة وقوية لا تُخطئ طريقها'],
      ['خاصة', 'حكم الذهب', 'خمس كرات ذهبية تنتشر ثم تلاحق الخصم'],
      ['مهارة', 'حجاب الخداع', 'يختفي عن الأنظار ويترك وهمًا مكانه، وأول ضربةٍ من الخفاء أشدّ'],
    ],
    skill: { k: 'veil', cost: 30, cd: 9 },
  },
];

/** Short label for the skill button, e.g. "بوابة". */
export const skillLabel = (w: WizardDef) => w.ab[2][1].split(' ')[0];
