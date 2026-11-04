# أسرار الظلام

لعبة مبارزة سحرة ثلاثية الأبعاد بالوضع الأفقي: أربعة سحرة (نار، جليد، ظل، برق)، ومهارات حركية، وصراع شعاع، وجولات. ضد الحاسوب أو عبر الإنترنت مع صديق برمز.

- **العب بالمتصفح:** https://nawwacode-cmyk.github.io/nilofar-duel/
- **أندرويد:** آخر APK من صفحة Releases (يُبنى تلقائياً مع كل تعديل)
- **آيفون:** افتح اللعبة في Safari ← مشاركة ← إضافة إلى الشاشة الرئيسية

## التقنيات
TypeScript وVite وThree.js (WebGL)، وSupabase Realtime للعب عبر الإنترنت، وCapacitor لتطبيق الأندرويد، وGitHub Actions للبناء والنشر.

## التطوير
- `npm run dev`: تشغيل محلي. `npm test`: الاختبارات. `npm run build`: فحص الأنواع والبناء إلى `dist/`.
- `public/config.js`: رابط مشروع Supabase والمفتاح العام (publishable) فقط، ولا يوضع المفتاح السري أبداً.
- التفاصيل الكاملة للبنية والخطة في `HANDOFF.md`.

## المصادر والرخص
- الساحة: Reials Col·legis de St Jaume i St Maties، طرطوشة، مسح Giravolt على Sketchfab (CC BY 4.0)
- الشخصيات والحركات: Adobe Mixamo
- المؤثرات: Kenney Particle Pack (CC0)
- الأصوات: Mixkit، وKenney Sci-fi وImpact Sounds (CC0)، وBasic Spell Impacts من lentikula (CC0)
- الموسيقى: Medieval Fantasy Combat I من Cosme Leites
- الخطوط: Aref Ruqaa وIBM Plex Sans Arabic (SIL OFL)، وMaterial Symbols (Apache 2.0)

ملفات الشخصيات والأصوات والموسيقى مسموح استعمالها داخل اللعبة فقط، ولا يجوز توزيعها منفصلة عنها.
