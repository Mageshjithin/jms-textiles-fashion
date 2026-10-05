import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('public/vendor', {recursive: true});
await copyFile('node_modules/html5-qrcode/html5-qrcode.min.js', 'public/vendor/html5-qrcode.min.js');
console.log('Frontend assets ready. API: api/index.js');
