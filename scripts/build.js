import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const apiBaseUrl =
  process.env.QUEST_API_BASE_URL || 'https://quest-notes-be.vercel.app/api';

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of ['index.html', 'styles.css', 'app.js']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

fs.writeFileSync(
  path.join(dist, 'config.js'),
  `window.QUEST_NOTES_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`,
);

console.log(`Built Quest Notes Web with API: ${apiBaseUrl}`);
