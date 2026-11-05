/**
 * The Hunters story: every spoken line with its Arabic (Fusha) subtitle. The voices are English (a narrator),
 * generated once by tools/gen-story-voices.mjs into public/play/voice/<key>.mp3; the subtitles are what the player
 * reads. This file has no imports so that tool can load it directly with Node.
 */
export interface Line { key: string; en: string; ar: string }

export const SCENES = {
  /** Before the forest: who the boss was, what happened, what the hunters must do. */
  intro: [
    { key: 'intro1', en: 'Long before Ehab, the Academy had another master.', ar: 'قبلَ إيهاب، كان للأكاديمية سيّدٌ آخر.' },
    { key: 'intro2', en: 'He wanted to defeat death itself… so he walked into the swamp.', ar: 'أراد أن يقهرَ الموتَ نفسَه… فدخلَ المستنقع.' },
    { key: 'intro3', en: 'Something else walked out. And since that night, the forest does not sleep.', ar: 'وخرجَ منه شيءٌ آخر. ومنذ تلك الليلة، لا تنامُ الغابة.' },
    { key: 'intro4', en: 'Hunter. Cross the Forest of Spirits. The gate at its end leads to the cursed village.', ar: 'أيّها الصيّاد، اعبُرْ غابةَ الأرواح؛ فالبوابةُ في آخرها تقودُك إلى القريةِ الملعونة.' },
  ],
  /** Stepping into the forest's gate. */
  forestEnd: [
    { key: 'forest_end1', en: 'The forest falls silent behind you.', ar: 'تصمتُ الغابةُ خلفَك.' },
    { key: 'forest_end2', en: 'Ahead, smoke rises from a village no one has left in years.', ar: 'وأمامَك دخانٌ يتصاعدُ من قريةٍ لم يغادرْها أحدٌ منذ سنين.' },
  ],
  /** Arriving in the village. */
  villageIntro: [
    { key: 'v_intro1', en: 'The villagers never left. They only stopped being villagers.', ar: 'أهلُ القريةِ لم يرحلوا قطّ… لكنّهم لم يعودوا بشرًا.' },
    { key: 'v_intro2', en: 'Cleanse the village. The road to the swamp begins at the mill.', ar: 'طهِّرِ القرية؛ فطريقُ المستنقعِ يبدأُ من الطاحونة.' },
  ],
  /** The mill's warden steps out (spoken during play, no bars). */
  warden: [
    { key: 'v_warden', en: "The mill's warden. He still guards his master's road.", ar: 'حارسُ الطاحونة… ما زالَ يحرسُ طريقَ سيّدِه.' },
  ],
  /** Stepping into the village's gate. */
  villageEnd: [
    { key: 'v_end1', en: 'The village is quiet now.', ar: 'هدأتِ القريةُ أخيرًا.' },
    { key: 'v_end2', en: 'Beyond the mill, the swamp is waiting. And so is he.', ar: 'وخلفَ الطاحونةِ ينتظرُ المستنقع… وينتظرُ هو.' },
  ],
  /** Facing the boss. */
  bossIntro: [
    { key: 'b_intro1', en: 'So this is what remains of the greatest mage the Academy ever had.', ar: 'هذا كلُّ ما بقيَ من أعظمِ سحرةِ الأكاديمية.' },
    { key: 'b_intro2', en: 'He will not die easily. Strike him from behind, where the swamp left him open.', ar: 'لن يموتَ بسهولة. اضربْه من الخلف؛ هناك تركَه المستنقعُ مكشوفًا.' },
  ],
  /** Boss phases (spoken during play). */
  bossRage: [
    { key: 'b_rage', en: 'He is angry now. Dodge his waves.', ar: 'لقد غضب. راوِغْ موجاتِه.' },
  ],
  bossSwamp: [
    { key: 'b_swamp', en: 'The swamp itself rises to save him. Keep moving!', ar: 'المستنقعُ نفسُه ينهضُ لينقذَه. لا تتوقّف!' },
  ],
  /** The boss falls. */
  victory: [
    { key: 'end1', en: 'It is over. The swamp lets go of its master.', ar: 'انتهى الأمر. أطلقَ المستنقعُ سيّدَه.' },
    { key: 'end2', en: 'And the forest, for the first time in years, sleeps.', ar: 'ونامتِ الغابة، لأوّلِ مرّةٍ منذ سنين.' },
  ],
} satisfies Record<string, Line[]>;

export type SceneId = keyof typeof SCENES;

/** First meeting with each kind of monster: a name card with one line (text only). */
export const BESTIARY: Record<string, string> = {
  wolf: 'يصطادُ في جماعات، ويقفزُ على فريستِه من بعيد.',
  spider: 'بطيئٌ حتى يقترب، ثمّ لا يُخطئ.',
  skeleton: 'حرّاسٌ قُتلوا هنا، وما زالوا يحرسون.',
  ghost: 'روحٌ ضلّت طريقَها؛ لا تُرى إلّا ليلًا.',
  greatwolf: 'سيّدُ الذئاب. نادرًا ما يظهر، ولا يتراجعُ أبدًا.',
  villager: 'كانوا أهلَ القرية… قبلَ اللعنة.',
  parasite: 'يتغذّى على ما بقيَ من الأجساد.',
  warden: 'حارسُ الطاحونة؛ لم يتركْ مكانَه منذ سقطتِ القرية.',
  mutant: 'هذا ما بقيَ من أعظمِ سحرةِ الأكاديمية.',
};
