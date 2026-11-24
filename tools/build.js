#!/usr/bin/env node
/* 公開用ビルド: node tools/build.js [--zip] [--include-unused] [--version=1.0.0]
 *
 * dist/ に配布物だけを生成します (外部ツール不要)。
 *   - core.js + main.js を game.js に結合し、index.html を公開用に書き換え (PROD フラグ / noindex / 年齢確認)
 *   - assets/ のうち「いずれかのスロットに対応する実素材」だけをコピー (仮素材 _placeholder と未使用ファイルは除外)
 *   - 公開用 manifest.json を生成 (仮素材なし)
 *   - 開発用ファイル (sim.js, serve.js, tools/, README.md) は含めない
 * 検証: 必須スロットの未配置・巨大ファイル・名前の間違い・仮素材の混入を警告。致命的な問題があれば非0で終了。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const Core = require('../core.js');

const ROOT = path.join(__dirname, '..');
const SRC_ASSETS = path.join(ROOT, 'assets');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const has = f => args.includes(f);
const version = (args.find(a => a.startsWith('--version=')) || '').slice(10) || '0.1.0';
const stamp = new Date().toISOString().slice(0, 10);

const IMG = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']);
const VID = new Set(['.mp4', '.webm']);
const BIG = 25 * 1024 * 1024; // 1ファイルがこれを超えたら警告 (ホスティング制限対策)
const warns = [], errors = [];

// ---- 1. 実素材のスキャン (仮素材と manifest は対象外)
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_placeholder') walk(p, out); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (IMG.has(ext) || VID.has(ext)) out.push(p);
  }
  return out;
}
const slots = Core.listSlots();
const slotKeys = new Set(slots.map(s => s.key));
const files = {}, unused = [];
let used = [];
for (const p of walk(SRC_ASSETS, [])) {
  const key = path.basename(p, path.extname(p));
  const relp = path.relative(SRC_ASSETS, p).split(path.sep).join('/');
  if (slotKeys.has(key) || has('--include-unused')) { (files[key] = files[key] || []).push(relp); used.push(p); }
  else unused.push(relp);
  if (fs.statSync(p).size > BIG) warns.push(`巨大ファイル (${(fs.statSync(p).size / 1048576).toFixed(1)}MB): ${relp}`);
}
unused.forEach(u => warns.push(`どのスロットにも対応しないため除外: ${u}`));

// 必須スロット (ラベル/グループに「任意」を含まないもの) の未配置は警告。立ち絵(通常)と特別演出は本番品質に直結するので重要扱い
const requiredMissing = slots.filter(s => !/任意/.test(s.group) && !/任意/.test(s.label) && !(files[s.key] || []).length);
if (requiredMissing.length) {
  warns.push(`必須スロット未配置 ${requiredMissing.length} 件 (画面上は非表示/代替表示になります): ` +
    requiredMissing.slice(0, 6).map(s => s.key).join(', ') + (requiredMissing.length > 6 ? ' …' : ''));
}
if (!used.length) warns.push('実素材が1つもありません。素材なしの状態で公開されます。');

// ---- 2. dist 生成
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// game.js = core + main
const core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
fs.writeFileSync(path.join(DIST, 'game.js'), `/* build ${version} ${stamp} */\n${core}\n;\n${main}\n`);

// index.html (公開用に書き換え)
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const tags = '<script src="core.js"></script>\n<script src="main.js"></script>';
if (!html.includes(tags)) errors.push('index.html のスクリプトタグが想定と違います (build.js を更新してください)');
html = html.replace(tags, `<script>window.PROD=true;window.BUILD=${JSON.stringify(version + ' ' + stamp)};</script>\n<script src="game.js"></script>`);
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex,nofollow">\n<meta name="rating" content="adult">\n<meta name="referrer" content="no-referrer">');
html = html.replace('<title>配信者育成 MVP</title>', '<title>配信者育成</title>');
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// 実素材のコピー + manifest
let totalBytes = 0;
for (const p of used) {
  const relp = path.relative(SRC_ASSETS, p);
  const dst = path.join(DIST, 'assets', relp);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(p, dst);
  totalBytes += fs.statSync(p).size;
}
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
Object.keys(files).forEach(k => files[k].sort());
fs.writeFileSync(path.join(DIST, 'assets', 'manifest.json'), JSON.stringify({ version, files, placeholders: {} }));

// ---- 3. 公開物の自己検査
const distFiles = [];
(function scan(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? scan(p) : distFiles.push(path.relative(DIST, p).split(path.sep).join('/')); } })(DIST);
if (distFiles.some(f => f.includes('_placeholder'))) errors.push('dist に仮素材が混入しています');
if (distFiles.some(f => /(^|\/)(sim|serve|build|assets)\.js$/.test(f) && !f.endsWith('game.js'))) errors.push('dist に開発用スクリプトが混入しています');
const gameJs = fs.readFileSync(path.join(DIST, 'game.js'), 'utf8');
if (/console\.log|debugger/.test(gameJs)) warns.push('game.js に console.log / debugger が残っています');
if (!/window\.PROD/.test(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'))) errors.push('PROD フラグが index.html にありません');

// ---- 4. ZIP (任意)
let zipPath = null;
if (has('--zip')) {
  zipPath = path.join(ROOT, `streamer-game-${version}.zip`);
  fs.rmSync(zipPath, { force: true });
  try {
    if (process.platform === 'win32') {
      cp.execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'pipe' });
    } else {
      cp.execFileSync('zip', ['-qr', zipPath, '.'], { cwd: DIST, stdio: 'pipe' });
    }
  } catch (e) { errors.push('ZIP の作成に失敗: ' + String(e.message).split('\n')[0]); zipPath = null; }
}

// ---- 5. レポート
const kb = n => (n / 1024).toFixed(n > 1048576 ? 0 : 1) + 'KB';
console.log(`公開ビルド v${version} (${stamp}) → ${path.relative(process.cwd(), DIST) || 'dist'}`);
console.log(`  game.js ${kb(fs.statSync(path.join(DIST, 'game.js')).size)} / index.html ${kb(fs.statSync(path.join(DIST, 'index.html')).size)}`);
console.log(`  素材 ${used.length} ファイル (${(totalBytes / 1048576).toFixed(1)}MB) / スロット配置 ${Object.keys(files).filter(k => slotKeys.has(k)).length} / ${slots.length}`);
if (zipPath) console.log(`  ZIP: ${path.relative(process.cwd(), zipPath)} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)}MB)`);
warns.forEach(w => console.log('  ⚠ ' + w));
errors.forEach(e => console.log('  ✖ ' + e));
if (errors.length) process.exit(1);
console.log(errors.length ? '' : '  ✔ 検査OK (配信には HTTP サーバー / 静的ホスティングが必要です)');
