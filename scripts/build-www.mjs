// Builds the self-contained web bundle that goes inside the Android app (run after `npm run build`).
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
if (!existsSync('dist/play/index.html')) throw new Error('Run `npm run build` first.');
rmSync('www', { recursive: true, force: true }); mkdirSync('www');
cpSync('dist/play', 'www', { recursive: true });
cpSync('public/config.js', 'www/config.js');
let html = readFileSync('www/index.html', 'utf8');
html = html.replace('../config.js', './config.js')
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
  .replace(/<link rel="icon"[^>]*>\n?/, '')
  .replace(/<script>if\('serviceWorker'[^<]*<\/script>\n?/, '')
  .replace(/<a class="btn ghost" href="\.\.\/"[^>]*>[^<]*<\/a>/, '');
writeFileSync('www/index.html', html);
console.log('www ready');
