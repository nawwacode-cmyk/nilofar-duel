// Builds the self-contained web bundle that goes inside the Android app.
import {cpSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
rmSync('www',{recursive:true,force:true});mkdirSync('www');
cpSync('play','www',{recursive:true});
cpSync('config.js','www/config.js');
let html=readFileSync('www/index.html','utf8');
html=html.replace('../config.js','./config.js')
  .replace(/<link rel="manifest"[^>]*>\n?/,'')
  .replace(/<link rel="apple-touch-icon"[^>]*>\n?/,'')
  .replace(/<link rel="icon"[^>]*>\n?/,'')
  .replace(/<script>if\('serviceWorker'[^<]*<\/script>\n?/,'')
  .replace(/<a class="btn ghost" href="\.\.\/"[^>]*>[^<]*<\/a>/,'');
writeFileSync('www/index.html',html);
console.log('www ready');
