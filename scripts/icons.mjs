import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
const svg = await readFile('public/favicon.svg');
await Promise.all([
  sharp(svg).resize(192).png().toFile('public/icon-192.png'),
  sharp(svg).resize(512).png().toFile('public/icon-512.png'),
  sharp({ create: { width: 512, height: 512, channels: 4, background: '#12141A' } })
    .composite([{ input: await sharp(svg).resize(320).png().toBuffer(), top: 96, left: 96 }])
    .png().toFile('public/icon-maskable.png'),
]);
