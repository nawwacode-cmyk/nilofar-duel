// Generates the Hunters story narration (English neural voice; the game shows Arabic subtitles from
// src/hunt/script.ts). Trims silence, adds a light hall echo, evens loudness. Output: public/play/voice/<key>.mp3
// Needs Node 23.6+ (loads the .ts script directly) and the msedge-tts package, which is NOT a project dependency:
// install it in a scratch folder and run from there:  node <project>/tools/gen-story-voices.mjs <project>
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { mkdtempSync, renameSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.argv[2] || '.');
const { SCENES } = await import(pathToFileURL(join(ROOT, 'src/hunt/script.ts')).href);
const OUT = join(ROOT, 'public/play/voice');
mkdirSync(OUT, { recursive: true });

const VOICE = 'en-GB-RyanNeural', PITCH = '-10%', RATE = '-14%';
const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
for (const lines of Object.values(SCENES)) for (const { key, en } of lines) {
  const dir = mkdtempSync(join(tmpdir(), 'st-'));
  const { audioFilePath } = await tts.toFile(dir, en, { pitch: PITCH, rate: RATE });
  const raw = join(dir, 'raw.mp3'); renameSync(audioFilePath, raw);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,aecho=0.85:0.5:70:0.18,loudnorm=I=-16:TP=-1.5:LRA=7,apad=pad_dur=0.25',
    '-ar', '24000', '-ac', '1', '-b:a', '48k', join(OUT, key + '.mp3')]);
  console.log(key, en);
}
tts.close?.();
