import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// This file is copied to the root of the public static release repository.
// Cloudflare runs it there; no packages, account credentials or API calls are needed.
const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  throw new Error('Usage: node build-cloudflare.mjs [--out EMPTY_DIRECTORY]');
}
const destination = path.resolve(root, args[1] || 'cloudflare-dist');
const maxBytes = 25 * 1024 * 1024;
const githubBase = 'https://xmxkf.github.io/phoenix-campus-digital-twin/';
const externalDownloads = new Set([
  'output/cad/Phoenix_Campus_Drawings.pdf',
  'output/v2/campus_v2.glb',
]);
const roots = [
  'analysis', 'assets', 'evidence', 'output', 'public', 'renders',
  'viewer', 'viewer-twin', 'viewer-v2', 'index.html',
  '厂区坐北朝南望.jpg', '厂区坐南朝北望.jpg',
];
const files = [];
async function collect(relative) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink is not a release asset: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(source)) await collect(`${relative}/${name}`);
  } else if (stat.isFile()) {
    if (externalDownloads.has(relative)) return;
    if (stat.size > maxBytes) throw new Error(`Asset exceeds Cloudflare's 25 MiB limit: ${relative}`);
    files.push({relative, bytes: stat.size});
  } else throw new Error(`Unsupported release asset: ${relative}`);
}
for (const relative of roots) {
  const input = path.join(root, relative);
  if (destination === input || destination.startsWith(input + path.sep) || input.startsWith(destination + path.sep)) {
    throw new Error('Output directory must be separate from all release inputs');
  }
  await collect(relative);
}
const existing = await fs.readdir(destination).catch(error => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
if (existing.length) throw new Error('Output directory must be empty; no existing files will be overwritten');
await fs.mkdir(destination, {recursive: true});
for (const {relative} of files) {
  const target = path.join(destination, relative);
  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.copyFile(path.join(root, relative), target);
}
// Keep the shared directory tree intact, but make this deployment open the twin.
const indexPath = path.join(destination, 'index.html');
const index = await fs.readFile(indexPath, 'utf8');
if (!index.includes('0;url=viewer-v2/')) throw new Error('Unrecognized release index redirect');
await fs.writeFile(indexPath, index.replace('0;url=viewer-v2/', '0;url=viewer-twin/#FAB1'));
// The two original downloads stay available on GitHub Pages. The optimized
// exterior and all internal web models are served locally by Cloudflare.
await fs.writeFile(path.join(destination, '_redirects'), [...externalDownloads]
  .map(relative => `/${relative} ${githubBase}${relative} 302`).join('\n') + '\n');
// A top-level 404 prevents missing binary assets from returning the root HTML.
await fs.writeFile(path.join(destination, '404.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面未找到</title><body><h1>页面未找到</h1><p><a href="/viewer-twin/">进入数字孪生</a> · <a href="/viewer-v2/">进入厂区外部浏览</a></p></body></html>\n`);
console.log(JSON.stringify({
  output: destination,
  fileCount: files.length + 2,
  copiedMiB: +(files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(2),
  largestAssetMiB: +(Math.max(...files.map(file => file.bytes)) / 1024 / 1024).toFixed(2),
  home: '/viewer-twin/#FAB1',
  externalDownloads: [...externalDownloads],
}, null, 2));
