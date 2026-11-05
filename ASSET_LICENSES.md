# Asset licences — أسرار الظلام

Every external asset shipped in the game, its source, creator, licence and what the licence requires.
Generated content (posters, Tripo models) is listed too, so the origin of every file is known.

| Asset (in the game) | Source | Creator | Licence | Requirements |
|---|---|---|---|---|
| Stone court arena (`models/court2*`) — Reials Col·legis de St Jaume i St Maties, Tortosa | Sketchfab | Giravolt | CC BY 4.0 | Credit the creator (shown on the title screen) |
| Palace courtyard arena (`models/girona*`) — Pati del Palau Episcopal, Museu d'Art de Girona | Sketchfab | Giravolt | CC BY 4.0 | Credit the creator (shown on the title screen) |
| Castle terrace textures (stone, tiles) | polyhaven.com | Poly Haven | CC0 | None (credit appreciated) |
| Wizard models Reem, Siraj, Layla, Qasem and all fighter animations | mixamo.com | Adobe Mixamo | Mixamo terms (free use in games) | Not redistributable as standalone assets |
| Wizard models Ehab, Sara, Abed | Tripo (generated for the project owner) | Project owner | Owner's generated content | — |
| Character posters and faces (`models/portraits/*`) | ChatGPT image generation (owner's account) | Project owner | Owner's generated content | — |
| Particle sprite atlas (`models/fx.webp`) | kenney.nl — Particle Pack | Kenney | CC0 | None (credit appreciated) |
| Impact sounds `k_punch*`, `k_thud*`, `k_ice*` (`sfx/`) | kenney.nl — Impact Sounds | Kenney | CC0 | None (credit appreciated) |
| Spell, cast and ambience sounds (`m_*`, `c_*`, others in `sfx/`) | mixkit.co, freesound.org (lentikula), kenney.nl | Mixkit; lentikula; Kenney | Mixkit Sound Effects Free License; CC0; CC0 | Mixkit: no standalone redistribution |
| Music (`sfx/music`) — "Heavy Combat" | — | Cosme Leites | Free for use in projects; not redistributable on its own | Credit (shown on the title screen) |
| Fonts: Alexandria; Material Symbols (icon subset) | Google Fonts | Mohamed Gaber / Google | SIL Open Font License 1.1; Apache 2.0 | Keep licence notices; no selling the fonts alone |
| Title, loading and menu backgrounds (`img/*`) | Project owner | Project owner | Owner's content | — |

## Procedural (made in code, no external files)
- Tornado funnel and orbiting dust (`src/fx/tornado.ts`), light ribbons, shock rings and domes, ground decals,
  branching lightning (`src/fx/vfx.ts`), heat/shock distortion and anti-aliasing passes (`src/render/post.ts`),
  arena-captured image lighting and element rim light (`src/render/charLight.ts`).

## Kept outside the game (not shipped)
- Forest map and monsters of the removed Hunters mode: `Desktop/asrar-monsters-forest` (credits in its «اقرأني» file):
  Dirt Road Through Forest — 99.Miles (CC BY); Wolf with Animations — 3DHaupt (CC BY); Great Grey Wolf Sif —
  Catholomew (CC BY-NC, **non-commercial**); Wolf Spider — DreamingInAlternation27 (CC BY); Mixamo monsters.
