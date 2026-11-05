// All runtime strings in Modern Standard Arabic. Static labels live in web/play/index.html.
import type { WizardDef } from '../core/types';

/** Picks the masculine or feminine verb form for a wizard. */
const v = (w: WizardDef, m: string, f: string) => (w.female ? f : m);

export const TXT = {
  loadFail: 'تعذّر تحميل الساحة أو الشخصيات. يُرجى تحديث الصفحة.',
  round: (n: number) => `الجولة ${n}`,
  versus: (a: string, b: string) => `${a} ضد ${b}`,
  fight: 'ابدأ!',
  // `name` may carry a "(أنت)"-style tag in mirror matches.
  roundWon: (w: WizardDef, name = w.name) => `${name} ${v(w, 'حسم', 'حسمت')} الجولة`,
  matchWon: (w: WizardDef, name = w.name) => `${name} ${v(w, 'فاز', 'فازت')} بالمبارزة!`,
  endTitle: (w: WizardDef, name = w.name) => `${name} ${v(w, 'فاز', 'فازت')}!`,
  /** Tags that tell the two fighters apart when both picked the same wizard. */
  youTag: '(أنت)',
  oppTag: (online: boolean) => (online ? '(صديقك)' : '(الحاسوب)'),
  endOnlineWin: 'أحسنت! لقد هزمت صديقك',
  endOnlineLose: 'تغلّب عليك صديقك هذه المرة',
  endAiWin: 'هزمت الحاسوب. جرّب مستوى أصعب إن كنت تجرؤ',
  endAiLose: 'هزمك الحاسوب. جرّب ساحرًا آخر أو أكثِر من المراوغة',
  parry: 'ارتداد!',
  backstab: 'ضربة خلفية!',
  fatalBlow: 'الضربة القاتلة!',
  fatality: 'القضاء الأخير!',
  finishHim: (loser: WizardDef) => (loser.female ? 'اقضِ عليها!' : 'اقضِ عليه!'),
  fatalDodged: 'أفلت!',
  fatalBlocked: 'صدّها!',
  fatalBtn: 'قاتلة',
  fatalityBtn: 'إعدام',
  shieldBroken: 'انكسر الدرع!',
  struggle: 'صراع الشعاع! اضغط أسرع من خصمك',
  loadingFighters: (p: number) => `جارٍ تحميل الساحرَين… ${p}%`,
  muteOn: 'صامت',
  muteOff: 'صوت',
  stats: { hp: 'الصحة', speed: 'السرعة', power: 'القوة' },
  abilitiesOf: (w: WizardDef) => (w.female ? 'قدراتها' : 'قدراته'),
  abilityKeys: ['J', 'I', 'U'] as const,
  online: {
    disabled: 'اللعب عبر الإنترنت غير مفعّل في هذه النسخة.',
    badCode: 'يجب أن يتكوّن الرمز من 4 أحرف',
    searching: 'جارٍ البحث عن المبارزة…',
    connectFail: 'تعذّر الاتصال بخادم المبارزات. تحقّق من اتصالك وحاول مجددًا.',
    peerLeft: 'غادر صديقك المبارزة',
    peerPicked: (name: string) => `اختيار صديقك: ${name}`,
  },
} as const;
