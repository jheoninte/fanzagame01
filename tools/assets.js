#!/usr/bin/env node
/* 素材スロット管理ツール
 *   node tools/assets.js            スキャン → assets/manifest.json 更新 + 未配置スロットの仮素材(SVG)生成 + レポート
 *   node tools/assets.js --no-ph    仮素材を作らない (既存の仮素材は削除)
 *   node tools/assets.js --clean    仮素材をすべて削除してから実行
 *
 * assets/ 以下の好きなフォルダに「スロットkey.拡張子」で置けば自動で認識されます。
 *   画像: png webp jpg jpeg gif svg / 動画: mp4 webm   (assets/_placeholder は仮素材置き場なので触らない)
 */
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');

const ROOT = path.join(__dirname, '..', 'assets');
const PH_DIR = path.join(ROOT, '_placeholder');
const IMG = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']);
const VID = new Set(['.mp4', '.webm']);
const args = new Set(process.argv.slice(2));

fs.mkdirSync(ROOT, { recursive: true });

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p !== PH_DIR) walk(p, out); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (IMG.has(ext) || VID.has(ext)) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

// 1. 実素材をスキャン (key = 拡張子を除いたファイル名)
const files = {};
for (const p of walk(ROOT, [])) {
  const key = path.basename(p, path.extname(p));
  (files[key] = files[key] || []).push(rel(p));
}
Object.keys(files).forEach(k => files[k].sort());

// 2. 仮素材
if (args.has('--clean') && fs.existsSync(PH_DIR)) fs.rmSync(PH_DIR, { recursive: true, force: true });
const slots = Core.listSlots();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HUES = { '立ち絵': 300, 'イベント絵 (任意)': 250, '特別演出': 330, 'ライブ演出 (任意)': 200, 'エンディング': 40 };
function svgFor(s) {
  const portrait = s.ratio === '3:4';
  const w = portrait ? 600 : 1280, h = portrait ? 800 : 720;
  const hue = HUES[s.group] != null ? HUES[s.group] : 270;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},55%,42%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<g fill="none" stroke="#ffffff33" stroke-width="2"><rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="18" stroke-dasharray="14 10"/></g>
<g fill="#fff" font-family="'Yu Gothic UI','Hiragino Sans',sans-serif" text-anchor="middle">
<text x="${w / 2}" y="${h / 2 - 28}" font-size="${portrait ? 34 : 40}" font-weight="700">${esc(s.label)}</text>
<text x="${w / 2}" y="${h / 2 + 22}" font-size="${portrait ? 24 : 28}" opacity=".85">${esc(s.key)}</text>
<text x="${w / 2}" y="${h / 2 + 64}" font-size="20" opacity=".6">PLACEHOLDER (${s.ratio}) - 差し替えてください</text></g></svg>`;
}
const placeholders = {};
const wantPh = !args.has('--no-ph');
if (wantPh) fs.mkdirSync(PH_DIR, { recursive: true });
for (const s of slots) {
  const phPath = path.join(PH_DIR, s.key + '.svg');
  const hasReal = (files[s.key] || []).length > 0;
  if (!hasReal && wantPh) {
    fs.writeFileSync(phPath, svgFor(s));
    placeholders[s.key] = '_placeholder/' + s.key + '.svg';
  } else if (fs.existsSync(phPath)) {
    fs.rmSync(phPath); // 実素材が入った / 仮素材不要
  }
}

// 3. manifest
const manifest = { generated: new Date().toISOString(), files, placeholders };
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// 4. レポート
const groups = {};
slots.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
let have = 0;
console.log('素材スロット状況');
for (const g of Object.keys(groups)) {
  const arr = groups[g], ok = arr.filter(s => (files[s.key] || []).length);
  have += ok.length;
  console.log(`  ${g.padEnd(14, '　')} ${String(ok.length).padStart(2)} / ${arr.length}`);
  arr.filter(s => !(files[s.key] || []).length && !/任意/.test(g) && !/任意/.test(s.label))
    .forEach(s => console.log(`      未配置: ${s.key}  (${s.label}, ${s.ratio})`));
}
console.log(`合計 ${have} / ${slots.length} スロット配置済み${wantPh ? ` / 仮素材 ${Object.keys(placeholders).length} 件を assets/_placeholder に生成` : ''}`);
const known = new Set(slots.map(s => s.key));
const unknown = Object.keys(files).filter(k => !known.has(k));
if (unknown.length) {
  console.log('\n⚠ どのスロットにも対応しないファイル (名前の間違いかも):');
  unknown.forEach(k => console.log('   ' + files[k].join(', ')));
}
