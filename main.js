/* UI. ロジックは core.js、ここは表示と進行のみ */
(function () {
  'use strict';
  const C = window.Core;
  const app = document.getElementById('app');

  // ---------- storage ----------
  const SAVE_KEY = 'streamerMvp.save.v1', META_KEY = 'streamerMvp.meta.v1';
  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  let meta = load(META_KEY, { cards: [], seen: [], endings: {} });
  let S = null;
  let sel = null;            // {id, inten}
  let tab = 'lesson';
  let busy = false;

  // ---------- helpers ----------
  const NAMES = { subs: '登録者', money: '資金', stamina: '体力', mental: 'メンタル', happy: '幸福', love: '親密度', tank: '期待値' };
  C.ABIL_KEYS.forEach(k => { NAMES[k] = C.ABILITIES[k].name; });
  const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const num = n => Math.round(n).toLocaleString('ja-JP');
  function deltaChips(d) {
    const keys = Object.keys(d);
    if (!keys.length) return '';
    return '<div class="deltas">' + keys.map(k => {
      const v = d[k], up = v > 0;
      // 期待値と炎上リスクは上がるのが良いとは限らないので中立色
      const cls = (k === 'tank') ? '' : (up ? 'up' : 'down');
      const txt = k === 'money' ? (up ? '+' : '-') + yen(Math.abs(v)) : (up ? '+' : '') + num(v);
      return `<span class="chip ${cls}">${NAMES[k]} ${txt}</span>`;
    }).join('') + '</div>';
  }
  // ---------- assets (素材スロット) ----------
  // assets/manifest.json (node tools/assets.js が生成) を読み、実素材 → 仮素材 → 説明ボックス の順に表示する。
  // manifest が読めない場合 (file:// 直開きなど) は assets/<key>.png を直接探索する。
  const IMG_RE = /\.(png|webp|jpe?g|gif|svg)$/i, VID_RE = /\.(mp4|webm)$/i;
  // 公開ビルド(tools/build.js)では window.PROD=true。開発用の表示(素材スロット画面・説明ボックス)を隠す
  const PROD = !!window.PROD;
  const AS = { manifest: null, debug: !PROD && !!load('streamerMvp.slotdebug', false) };
  async function loadManifest() {
    try {
      const r = await fetch('assets/manifest.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const m = await r.json();
      AS.manifest = { files: m.files || {}, placeholders: m.placeholders || {} };
    } catch (e) { AS.manifest = null; }
  }
  // keys を先頭から順に探し、実素材があればそれ、無ければ先頭 key の仮素材。manifest 不明なら null
  function resolveAsset(keys) {
    const m = AS.manifest;
    if (!m) return null;
    for (const k of keys) {
      const f = m.files[k] || [];
      const vid = f.find(x => VID_RE.test(x)), img = f.find(x => IMG_RE.test(x));
      if (vid || img) return { kind: 'real', key: k, vid, img };
    }
    const ph = m.placeholders[keys[0]];
    return ph ? { kind: 'ph', key: keys[0], img: ph } : { kind: 'none', key: keys[0] };
  }
  const assetUrl = p => 'assets/' + p.split('/').map(encodeURIComponent).join('/');
  function mediaTag(a) {
    if (a.vid) return `<video src="${assetUrl(a.vid)}" ${a.img ? `poster="${assetUrl(a.img)}"` : ''} autoplay loop muted playsinline></video>`;
    return `<img src="${assetUrl(a.img)}" alt="">`;
  }
  // opts.optional: 素材も仮素材も無ければ何も表示しない (イベント絵・ライブ演出向け)
  function slotHTML(key, opts) {
    if (!key) return '';
    const optional = !!(opts && opts.optional);
    const a = resolveAsset([key]);
    const cap = AS.debug ? `<div class="cap">${key}</div>` : '';
    if (!a) {
      if (optional || PROD) return '';
      const base = 'assets/' + key;
      return `<div class="slot"><span class="ph">【演出スロット: ${key}】<br>${base}.png / .mp4 を置くとここに表示されます</span>` +
        `<img src="${base}.png" alt="" onload="this.parentNode.querySelector('.ph').style.display='none'" onerror="this.remove()"></div>`;
    }
    if (a.kind === 'none') {
      return (optional || PROD) ? '' : `<div class="slot"><span class="ph">【演出スロット: ${key}】<br>assets/ に ${key}.png / .mp4 を置き、node tools/assets.js を実行してください</span>${cap}</div>`;
    }
    return `<div class="slot has ${a.kind}">${mediaTag(a)}${cap}</div>`;
  }
  // 立ち絵: 状態差分 (_good / _bad) があればそれを使い、無ければ通常の立ち絵
  function portraitHTML(s) {
    const ch = C.CHARS[s.charId || 'kotoha'];
    const cond = C.condition(s).name;
    const st = cond === '調子◎' ? '_good' : cond === '不調' ? '_bad' : '';
    const base = 'portrait_' + ch.id;
    const a = resolveAsset(st ? [base + st, base] : [base]);
    const cap = AS.debug ? `<div class="cap">${a ? a.key : base}</div>` : '';
    const label = PROD ? `<span style="font-size:18px;font-weight:700">${ch.name}</span>` : `<span>PORTRAIT SLOT<br>assets/${base}.png</span>`;
    if (a && a.kind !== 'none') return `<div class="portrait has">${mediaTag(a)}${cap}</div>`;
    if (a) return `<div class="portrait">${label}${cap}</div>`;
    return `<div class="portrait">${label}<img src="assets/${base}.png" alt="" onload="this.parentNode.querySelector('span').style.display='none'" onerror="this.remove()"></div>`;
  }
  async function showAssets() {
    for (;;) {
      const slots = C.listSlots(), m = AS.manifest;
      const st = s => (!m ? '?' : (m.files[s.key] || []).length ? 'ok' : m.placeholders[s.key] ? 'ph' : 'ng');
      const groups = {};
      slots.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
      const have = slots.filter(s => st(s) === 'ok').length;
      const head = m
        ? `配置済み <b>${have} / ${slots.length}</b> スロット (✔配置済み ◐仮素材 ✘なし)`
        : 'manifest が見つかりません。<code>node tools/assets.js</code> を実行してから「再読み込み」を押してください (file:// で開いている場合は直接探索モードで動作します)。';
      const mark = { ok: '✔', ph: '◐', ng: '✘', '?': '？' };
      const html = `<h2>素材スロット</h2>
        <p style="font-size:13px;color:var(--sub)">${head}<br>assets/ 以下の任意のフォルダに「スロットkey.png / .webp / .mp4 など」を置き、<code>node tools/assets.js</code> を実行します。</p>
        <label style="font-size:13px"><input type="checkbox" id="onlyMissing"> 未配置のみ表示</label>
        ${Object.keys(groups).map(g => {
          const arr = groups[g];
          return `<h3 style="margin:14px 0 6px">${g} (${arr.filter(s => st(s) === 'ok').length}/${arr.length})</h3>` +
            arr.map(s => `<div class="arow ${st(s)}"><span class="mk">${mark[st(s)]}</span><span class="al">${s.label}</span><code>${s.key}</code></div>`).join('');
        }).join('')}`;
      const i = await modal(html, [{ label: '再読み込み' }, { label: 'スロット名表示: ' + (AS.debug ? 'ON' : 'OFF') }, { label: '閉じる', primary: true }],
        el => { el.querySelector('#onlyMissing').onchange = e => el.classList.toggle('only-missing', e.target.checked); });
      if (i === 0) { await loadManifest(); continue; }
      if (i === 1) { AS.debug = !AS.debug; store('streamerMvp.slotdebug', AS.debug); continue; }
      break;
    }
  }

  function modal(html, buttons, onMount) {
    return new Promise(res => {
      const el = document.createElement('div');
      el.className = 'modal';
      el.innerHTML = `<div class="box">${html}<div class="acts"></div></div>`;
      const acts = el.querySelector('.acts');
      buttons.forEach((b, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.primary ? ' primary' : '');
        btn.textContent = b.label;
        btn.onclick = () => { el.remove(); res(i); };
        acts.appendChild(btn);
      });
      document.body.appendChild(el);
      if (onMount) onMount(el);
    });
  }
  const ok = (html, label) => modal(html, [{ label: label || 'つぎへ', primary: true }]);

  // ---------- render ----------
  function bar(v, max, cls) {
    return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%"></i></div>`;
  }
  let pickChar = 'kotoha';
  let pickMode = load('streamerMvp.mode', 'short');
  function charDetail(id) {
    const ch = C.CHARS[id];
    return `<div class="panel" style="max-width:640px;margin:12px auto;text-align:left">
      <b>${ch.name}</b> <span class="chip">${ch.age}歳</span>
      <p style="margin:6px 0;color:var(--sub);font-size:13px">${ch.tagline}</p>
      ${ch.traits.map(t => `<div class="cardslot"><b>${t.name}</b>${t.desc}</div>`).join('')}
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-top:6px">
        ${C.ABIL_KEYS.map(k => `<span>${C.ABILITIES[k].icon}${C.ABILITIES[k].name} <b>${C.rankOf(ch.abil[k])}</b>(${ch.abil[k]})</span>`).join('')}
      </div></div>`;
  }
  function renderTitle() {
    const hasSave = !!load(SAVE_KEY, null);
    const owned = [...new Set([...C.STARTER_CARDS, ...meta.cards])];
    meta.cleared = meta.cleared || {};
    if (!C.isUnlocked(pickChar, meta.cleared)) pickChar = 'kotoha';
    app.innerHTML = `
      <div class="title">
        <h1>配信者育成 MVP</h1>
        <p style="color:var(--sub)">新人配信者を12週間でトップへ。担当するキャラクターを選んでください。</p>
        <div class="chargrid">
          ${C.CHAR_IDS.map(id => {
            const ch = C.CHARS[id], un = C.isUnlocked(id, meta.cleared);
            return `<button class="charcard ${pickChar === id ? 'sel' : ''}" data-char="${id}" ${un ? '' : 'disabled'}>
              <div class="cname">${un ? ch.name : '？？？'}</div>
              <div class="csub">${un ? ch.age + '歳' : '🔒 ' + C.CHARS[ch.unlock].short + 'でクリアすると解放'}</div></button>`;
          }).join('')}
        </div>
        ${charDetail(pickChar)}
        <div class="chargrid" style="margin:8px 0">
          ${Object.values(C.MODES).map(m => `<button class="charcard ${pickMode === m.id ? 'sel' : ''}" data-mode="${m.id}" style="min-width:220px;max-width:280px">
            <div class="cname">${m.name}モード</div><div class="csub">${m.desc}</div></button>`).join('')}
        </div>
        <div class="panel" style="max-width:640px;margin:12px auto;text-align:left">
          <h3>サポートカード (2枚まで)</h3>
          ${owned.map((id, i) => `<label class="cardslot" style="display:block;cursor:pointer">
            <input type="checkbox" name="card" value="${id}" ${i < 2 ? 'checked' : ''}>
            <b style="display:inline;margin-left:6px">${C.CARDS[id].name}</b><br>${C.CARDS[id].desc}</label>`).join('')}
        </div>
        <button class="btn primary" id="newBtn">はじめから</button>
        <button class="btn" id="contBtn" ${hasSave ? '' : 'disabled'}>つづきから</button>
        <button class="btn" id="galBtn">図鑑</button>
        ${PROD ? '' : '<button class="btn" id="assetBtn">素材スロット</button>'}
        <p style="color:var(--sub);font-size:11px;margin-top:18px">v${window.BUILD || 'dev'} / データはこのブラウザ内にのみ保存されます</p>
      </div>`;
    const boxes = [...app.querySelectorAll('input[name=card]')];
    boxes.forEach(b => b.onchange = () => {
      if (boxes.filter(x => x.checked).length > 2) b.checked = false;
    });
    app.querySelectorAll('.charcard[data-char]').forEach(b => b.onclick = () => { pickChar = b.dataset.char; renderTitle(); });
    app.querySelectorAll('.charcard[data-mode]').forEach(b => b.onclick = () => { pickMode = b.dataset.mode; store('streamerMvp.mode', pickMode); renderTitle(); });
    document.getElementById('newBtn').onclick = () => {
      const cards = boxes.filter(x => x.checked).map(x => x.value);
      S = C.newGame((Date.now() & 0x7fffffff) | 1, cards, pickChar, pickMode);
      store(SAVE_KEY, S); sel = null; tab = 'lesson'; renderGame();
    };
    document.getElementById('contBtn').onclick = () => { S = load(SAVE_KEY, null); if (S) { sel = null; renderGame(); } };
    document.getElementById('galBtn').onclick = showGallery;
    if (!PROD) document.getElementById('assetBtn').onclick = showAssets;
  }

  function renderGame() {
    const s = S, ch = C.CHARS[s.charId || 'kotoha'], cond = C.condition(s), tier = C.tankTier(s.tank);
    const M = C.modeOf(s);
    const nextLive = M.liveWeeks.find(w => w >= s.week);
    const target = M.targets[nextLive];
    const liveNo = M.liveWeeks.indexOf(nextLive) + 1;
    const hearts = n => '♥'.repeat(n) + '♡'.repeat(5 - n);
    const loveStep = Math.min(5, Math.floor(s.love / 20));
    const burst = Math.round(C.burstChance(s.tank, s) * 100);
    const bonus = Math.round(C.tankLiveBonus(s.tank) * 100);

    app.innerHTML = `
    <header>
      <div class="week">${s.week}<small> / ${M.weeks}週</small></div>
      <div class="goal">
        <div style="font-size:12px;color:var(--sub)">次のライブ ${liveNo}/${M.liveWeeks.length}「${M.stageNames[nextLive]}」(${nextLive}週目) 目標 ${num(target)}人 / 現在 ${num(s.subs)}人</div>
        ${bar(s.subs, target, 'pink')}
      </div>
      <span class="chip">資金 ${yen(s.money)}</span>
      <button class="btn" id="menuBtn">メニュー</button>
    </header>
    <main>
      <section class="panel">
        ${portraitHTML(s)}
        <div style="margin-top:8px"><b>${ch.name}</b> <span class="chip">${cond.name}</span><div style="margin-top:4px">${ch.traits.map(x => `<span class="chip" title="${x.desc}">${x.name}</span>`).join(' ')}</div></div>
        <div class="hearts">${hearts(loveStep)}</div>
        <div class="row"><span class="k">親密度</span>${bar(s.love, 100, 'pink')}<span class="v">${s.love}</span></div>
        <div class="row"><span class="k">体力</span>${bar(s.stamina, 100, 'green')}<span class="v">${s.stamina}</span></div>
        <div class="row"><span class="k">メンタル</span>${bar(s.mental, 100, 'blue')}<span class="v">${s.mental}</span></div>
        <div class="row"><span class="k">幸福</span>${bar(s.happy, 100, 'gold')}<span class="v">${s.happy}</span></div>
        <div class="tank">
          <div style="display:flex;justify-content:space-between"><span class="t-name">期待値タンク</span><span>${s.tank}/${C.CFG.tankMax}</span></div>
          ${bar(s.tank, C.CFG.tankMax, 'gold')}
          <div style="font-size:12px;margin-top:6px;color:var(--sub)">${tier.name} ×${tier.mult.toFixed(1)}<br>ライブ時 +${bonus}% / 炎上リスク ${burst}%/週</div>
        </div>
      </section>
      <section class="center">
        <div class="panel stage" id="stage">
          <div style="font-size:15px;color:var(--text)">今週は何をする？</div>
          <div>下のコマンドを選んで「実行」。期待値を溜めるほどライブで爆発しますが、${'炎上'}リスクも上がります。</div>
        </div>
        <div class="panel log" id="log">${logHTML()}</div>
      </section>
      <section class="panel">
        <h3>能力</h3>
        ${C.ABIL_KEYS.map(k => `<div class="abil"><span>${C.ABILITIES[k].icon}</span><span style="width:64px">${C.ABILITIES[k].name}</span>
          <span class="rk">${C.rankOf(s.abil[k])}</span>${bar(s.abil[k], 1000, 'blue')}<span style="width:34px;text-align:right">${s.abil[k]}</span></div>`).join('')}
        <h3 style="margin-top:14px">サポートカード</h3>
        ${s.cards.map(id => `<div class="cardslot"><b>${C.CARDS[id].name}</b>${C.CARDS[id].desc}</div>`).join('')}
      </section>
    </main>
    <section class="cmdwrap panel">
      <div class="tabs">
        ${[['lesson', 'レッスン'], ['stream', '配信'], ['other', 'その他']].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}
      </div>
      <div class="cards">
        ${Object.keys(C.COMMANDS).filter(id => C.COMMANDS[id].group === tab).map(id => cardHTML(id)).join('')}
      </div>
      <div class="preview" id="preview"></div>
    </section>`;

    app.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; sel = null; renderGame(); });
    app.querySelectorAll('.card').forEach(b => b.onclick = () => { sel = { id: b.dataset.id, inten: (sel && sel.inten) || 'normal' }; renderGame(); });
    document.getElementById('menuBtn').onclick = async () => {
      const items = [{ k: 'title', label: 'タイトルへ' }, { k: 'gallery', label: '図鑑' }];
      if (!PROD) items.push({ k: 'assets', label: '素材スロット' });
      items.push({ k: 'close', label: '閉じる', primary: true });
      const k = items[await modal('<h2>メニュー</h2>', items)].k;
      if (k === 'title') renderTitle(); else if (k === 'gallery') showGallery(); else if (k === 'assets') { await showAssets(); renderGame(); }
    };
    renderPreview();
  }

  function logHTML() {
    const h = S.history.slice(-6).map(x => `${x.week}週目終了: 登録者 ${num(x.subs)}人`);
    return h.length ? h.reverse().join('<br>') : '<span style="color:var(--sub)">まだ記録はありません</span>';
  }

  function cardHTML(id) {
    const c = C.COMMANDS[id];
    const p = C.preview(S, id, 'normal');
    let sm = '';
    if (c.type === 'lesson') sm = `${C.ABILITIES[c.abil].name} +${p.gains[c.abil]}<br>体力 ${p.d.stamina}`;
    else if (c.type === 'stream') sm = `登録者 約+${num(p.fans)}<br>体力 ${p.d.stamina}`;
    else sm = Object.keys(p.d).map(k => `${NAMES[k]} ${p.d[k] > 0 ? '+' : ''}${p.d[k]}`).join(' / ');
    return `<button class="card ${sel && sel.id === id ? 'sel' : ''}" data-id="${id}" ${p.affordable ? '' : 'disabled'}>
      <span class="ic">${c.icon}</span><span class="nm">${c.name}</span><span class="sm">${sm}</span></button>`;
  }

  function renderPreview() {
    const el = document.getElementById('preview');
    if (!sel) { el.innerHTML = '<span style="color:var(--sub)">コマンドを選ぶと予測値が表示されます</span>'; return; }
    const c = C.COMMANDS[sel.id];
    const fixed = c.type === 'rest' || c.type === 'care' || c.type === 'meet';
    const p = C.preview(S, sel.id, sel.inten);
    const gains = Object.keys(p.gains).map(k => `${C.ABILITIES[k].name} <b class="up">+${p.gains[k]}</b>`).join(' / ');
    const d = Object.keys(p.d).map(k => {
      const v = p.d[k]; const bad = (k === 'tank') ? false : v < 0;
      return `${NAMES[k]} <b class="${k === 'tank' ? '' : (bad ? 'down' : 'up')}">${v > 0 ? '+' : ''}${k === 'money' ? yen(v) : v}</b>`;
    }).join(' / ');
    el.innerHTML = `
      <div class="grow">
        <b>${c.name}</b> <span class="chip">${p.condName}</span><br>
        ${gains ? gains + '<br>' : ''}
        ${p.fans ? `登録者 約<b class="up">+${num(p.fans)}</b> / 収入 約${yen(p.income)}<br>` : ''}
        ${d}<br>
        ${fixed ? '' : `失敗 ${Math.round(p.failRate * 100)}% / 大成功 ${Math.round(p.greatRate * 100)}%` + (S.stamina < 55 ? ' <span class="down">(体力55未満で失敗率UP)</span>' : '')}
      </div>
      ${fixed ? '' : `<div class="seg">${Object.keys(C.INTENS).map(k => `<button data-int="${k}" class="${sel.inten === k ? 'on' : ''}">${C.INTENS[k].name}</button>`).join('')}</div>`}
      <button class="btn primary" id="goBtn" ${p.affordable ? '' : 'disabled'}>${p.affordable ? '実行' : p.reason}</button>`;
    el.querySelectorAll('[data-int]').forEach(b => b.onclick = () => { sel.inten = b.dataset.int; renderPreview(); });
    document.getElementById('goBtn').onclick = playWeek;
  }

  // ---------- gameplay flow ----------
  async function playWeek() {
    if (busy || !sel) return;
    busy = true;
    try {
      const r = C.act(S, sel.id, sel.inten);
      if (r.error) { await ok(`<h2>実行できません</h2><p>${r.error}</p>`, '戻る'); return; }
      const tag = r.great ? '<span class="badge-great">大成功！</span>' : r.fail ? '<span class="badge-fail">失敗…</span>' : '成功';
      await ok(`<h2>${r.name}: ${tag}</h2>${deltaChips(r.delta)}`);

      const ev = C.drawEvent(S);
      if (ev) {
        const i = await modal(`<h2>${ev.title}</h2>${slotHTML('event_' + ev.id, { optional: true })}<p>${ev.text}</p>`,
          ev.choices.map((c, n) => ({ label: `【${c.tag}】${c.label}`, primary: n === 0 })));
        const res = C.chooseEvent(S, ev, i);
        meta.seen = [...new Set([...(meta.seen || []), ...S.seenEvents])]; store(META_KEY, meta);
        await ok(`<h2>${ev.title}</h2><p>${res.text}</p>${slotHTML(res.slot)}${deltaChips(res.delta)}`);
      }

      const week = S.week;
      const rep = C.finishWeek(S);
      if (rep.burst) {
        await ok(`<h2>🔥 炎上！</h2><p>期待値が溜まりすぎて暴発。タンクは空になり、登録者 -${num(rep.burst.lostSubs)}、メンタル -15。</p>`);
      }
      if (rep.live) {
        const L = rep.live;
        await ok(`<h2>🎆 ${L.stage}</h2>${slotHTML('live_' + week, { optional: true })}
          <p>期待値タンク ${L.usedTank} → <b>${L.tier.name} ×${L.tier.mult.toFixed(1)}</b> (ライブ効果 +${Math.round(L.bonus * 100)}%)</p>
          <p>ライブで登録者 <b class="up">+${num(L.gain)}</b> → 合計 ${num(L.subs)}人 / 目標 ${num(L.target)}人</p>
          <p>${L.pass ? '<b class="badge-great">目標達成！</b>' : '<b class="badge-fail">目標未達…</b>'}</p>`, 'つぎへ');
      }
      if (S.over) { await showEnding(); return; }
      store(SAVE_KEY, S); sel = null; renderGame();
    } finally { busy = false; }
  }

  async function showEnding() {
    const o = S.over;
    const card = C.cardFromEnding(o, S.charId);
    meta.cleared = meta.cleared || {};
    let extra = '';
    const firstClear = !!card && !meta.cleared[S.charId];
    if (card) meta.cleared[S.charId] = true;
    const next = C.CHAR_IDS.find(id => C.CHARS[id].unlock === S.charId);
    if (card && !meta.cards.includes(card)) { meta.cards.push(card); extra = `<p>🎴 新しいカード「${C.CARDS[card].name}」を獲得！</p>`; }
    meta.endings[o.id] = true; store(META_KEY, meta);
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    await ok(`<h2>ENDING: ${o.name}</h2><p>${o.text}</p>${slotHTML('ending_' + S.charId + '_' + o.id)}
      ${firstClear && next ?`<p>🔓 新キャラ「${C.CHARS[next].name}」が解放されました！</p>` : ''}<p>最終登録者 ${num(S.subs)}人 / 資金 ${yen(S.money)} / 親密度 ${S.love}</p>${extra}`, 'タイトルへ');
    renderTitle();
  }

  async function showGallery() {
    const seen = new Set(meta.seen || []);
    const rows = [];
    C.EVENTS.forEach(e => e.choices.forEach((c, i) => {
      const got = seen.has(e.id + ':' + i);
      rows.push(`<div class="cardslot"><b>${got ? e.title + ' ─ ' + c.tag : '？？？'}</b>${got ? c.result : '未解放'}${got && c.slot ? '<br><i>演出スロット: ' + c.slot + '</i>' : ''}</div>`);
    }));
    const ends = ['legend', 'duo', 'graduate', 'midway', 'burnout'].map(k => `${meta.endings[k] ? '✔' : '✘'} ${k}`).join(' / ');
    await modal(`<h2>図鑑</h2><p style="font-size:12px;color:var(--sub)">エンディング: ${ends}</p>${rows.join('')}`, [{ label: '閉じる', primary: true }]);
  }

  // 公開ビルドでは年齢確認 (20歳以上) を一度だけ表示
  function ageGate(next) {
    if (load('streamerMvp.age20', false)) return next();
    app.innerHTML = `<div class="title"><h1>年齢確認</h1>
      <p style="color:var(--sub)">このゲームには成人向けの表現が含まれる場合があります。<br>20歳以上の方のみご利用いただけます。</p>
      <button class="btn primary" id="ageYes">20歳以上です</button>
      <button class="btn" id="ageNo">20歳未満です</button></div>`;
    document.getElementById('ageYes').onclick = () => { store('streamerMvp.age20', true); next(); };
    document.getElementById('ageNo').onclick = () => { app.innerHTML = '<div class="title"><p>ご利用いただけません。</p></div>'; };
  }
  loadManifest().then(() => (PROD ? ageGate(renderTitle) : renderTitle()));
})();
