/* Streamer Manager MVP - core logic (browser + node 共用)
 * 全ての数値は CFG / COMMANDS / EVENTS に集約。UI は preview()/act() の結果を表示するだけ。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ゲームモード別の設定 (期間・ライブ週・目標登録者・ライブ規模)
  const MODES = {
    short: { id: 'short', name: '12週', weeks: 12, liveWeeks: [4, 8, 12], targets: { 4: 1300, 8: 4000, 12: 9500 },
      stageNames: { 4: 'ミニ配信イベント', 8: 'オフラインイベント', 12: '大規模ライブ' },
      stageMul: [1, 1.8, 3.0], legendSubs: 14000, duoLove: 75, recentWindow: 4, desc: 'ライブ3回。手早く遊べる標準モード。' },
    long: { id: 'long', name: '24週', weeks: 24, liveWeeks: [4, 8, 12, 16, 20, 24], targets: { 4: 1300, 8: 3500, 12: 7500, 16: 13000, 20: 21000, 24: 32000 },
      stageNames: { 4: 'ミニ配信イベント', 8: 'オフラインイベント', 12: 'ホールライブ', 16: '全国ツアー', 20: 'アリーナ公演', 24: 'ドーム公演' },
      stageMul: [1, 1.6, 2.4, 3.4, 4.6, 6.0], legendSubs: 60000, duoLove: 92, recentWindow: 8, desc: 'ライブ6回。育成も期待値管理もじっくり楽しむ長編モード。' },
  };
  const modeOf = s => MODES[(s && s.mode)] || MODES.short;

  const CFG = {
    tankMax: 800,
    lessonBase: 95,
    fanScale: 1.7,
    liveScale: 3.0,
    startSubs: 100,
    startMoney: 30000,
  };

  // 全員20歳以上の架空の人物。mods でキャラ固有のクセを表現。
  // lesson:{能力:倍率,all:倍率} / streamFan:{能力:倍率} / fan / tankGain / burst / ment(メンタル消費) / stam(体力消費) / love(親密度の上がりやすさ)
  const CHARS = {
    kotoha: { id: 'kotoha', name: '水無瀬ことは', short: 'ことは', age: 24, unlock: null,
      tagline: '元事務職OL。思い切って配信者に転身した新人。',
      abil: { talk: 180, game: 200, song: 150, visual: 170, charm: 190 }, happy: 40,
      traits: [{ name: 'バランス型', desc: '癖がなく扱いやすい。' }], mods: {} },
    ren: { id: 'ren', name: '星乃れん', short: 'れん', age: 22, unlock: 'kotoha',
      tagline: '大学4年生。歌が武器だが、緊張しやすい繊細タイプ。',
      abil: { talk: 130, game: 120, song: 300, visual: 180, charm: 170 }, happy: 35,
      traits: [{ name: '歌姫', desc: 'ボイトレ効果×1.3 / 歌枠のファン獲得×1.25' }, { name: '繊細', desc: 'メンタル消費×1.4' }],
      mods: { lesson: { song: 1.3 }, streamFan: { song: 1.25 }, ment: 1.4 } },
    mio: { id: 'mio', name: '氷川みお', short: 'みお', age: 27, unlock: 'ren',
      tagline: '元プロゲーマー。腕は確かだが人付き合いは不器用。',
      abil: { talk: 150, game: 330, song: 110, visual: 150, charm: 120 }, happy: 30,
      traits: [{ name: '元プロ', desc: 'ゲーム練習×1.25 / 実況のファン獲得×1.2' }, { name: '不器用', desc: '魅力練習×0.8 / 親密度の上昇×0.7' }],
      mods: { lesson: { game: 1.25, charm: 0.8 }, streamFan: { game: 1.2 }, love: 0.7 } },
    chisato: { id: 'chisato', name: '朝比奈ちさと', short: 'ちさと', age: 26, unlock: 'mio',
      tagline: '元アパレル店員。華があり、バズりやすいが炎上しやすい。',
      abil: { talk: 160, game: 100, song: 120, visual: 260, charm: 220 }, happy: 40,
      traits: [{ name: '華やか', desc: 'ビジュアル・魅力練習×1.15 / ファン獲得×1.05' }, { name: '話題体質', desc: '期待値の上昇×1.3 / 炎上確率×1.6' }],
      mods: { lesson: { visual: 1.15, charm: 1.15 }, fan: 1.05, tankGain: 1.3, burst: 1.6 } },
  };
  const CHAR_IDS = Object.keys(CHARS);
  const charOf = s => CHARS[s.charId || 'kotoha'];
  const modOf = (s, k, sub) => { const m = charOf(s).mods[k]; if (m == null) return 1; return sub ? (m[sub] || 1) : m; };
  const fmt = (s, t) => (t || '').replace(/\{n\}/g, charOf(s).short);

  const ABILITIES = {
    talk: { name: 'トーク', icon: '💬' },
    game: { name: 'ゲーム', icon: '🎮' },
    song: { name: '歌', icon: '🎤' },
    visual: { name: 'ビジュアル', icon: '✨' },
    charm: { name: '魅力', icon: '💗' },
  };
  const ABIL_KEYS = Object.keys(ABILITIES);
  const RANKS = [
    ['S', 900], ['A', 750], ['B', 600], ['C', 450], ['D', 300], ['E', 150], ['F', 0],
  ];
  function rankOf(v) {
    for (const [r, t] of RANKS) if (v >= t) return r;
    return 'F';
  }

  // 期待値タンク: 溜めるほど倍率UP、ただし炎上リスク
  const TANK_TIERS = [
    { min: 0, name: '静か', mult: 1.0 },
    { min: 100, name: 'ざわつき', mult: 1.5 },
    { min: 250, name: '盛り上がり', mult: 2.5 },
    { min: 450, name: '熱狂', mult: 4.0 },
    { min: 650, name: '伝説前夜', mult: 5.0 },
  ];
  function tankTier(t) {
    let r = TANK_TIERS[0];
    for (const x of TANK_TIERS) if (t >= x.min) r = x;
    return r;
  }
  function tankLiveBonus(t) { return (tankTier(t).mult - 1) / 4 * 2.0; } // 最大 +200%
  function burstChance(t, s) {
    if (t < 250) return 0;
    return Math.min(0.75, (t - 250) / 800 * 0.8 * (s ? modOf(s, 'burst') : 1));
  }

  // 強度
  const INTENS = {
    normal: { name: 'ふつう', gain: 1.0, stam: 1.0, fail: 0 },
    full: { name: '全力', gain: 1.4, stam: 1.5, fail: 0.05 },
    risky: { name: 'ハイリスク×2', gain: 1.9, stam: 2.0, fail: 0.4 },
  };

  // 卒業生カード (パッシブ)
  const CARDS = {
    senpai: { name: '先輩配信者・桐生ミレイ', desc: 'ゲーム練習の効果 ×1.3', lesson: { game: 1.3 } },
    manager: { name: '敏腕マネ・宇佐美', desc: '配信収入 ×1.5 / 魅力練習 ×1.1', income: 1.5, lesson: { charm: 1.1 } },
    grad_kotoha: { name: '卒業生・水無瀬ことは', desc: '全練習 ×1.1 / ファン獲得 ×1.1', lesson: { all: 1.1 }, fan: 1.1 },
    grad_ren: { name: '卒業生・星乃れん', desc: 'ボイトレ ×1.3 / 見た目磨き ×1.1', lesson: { song: 1.3, visual: 1.1 } },
    grad_mio: { name: '卒業生・氷川みお', desc: 'ゲーム練習 ×1.3 / 配信収入 ×1.25', lesson: { game: 1.3 }, income: 1.25 },
    grad_chisato: { name: '卒業生・朝比奈ちさと', desc: '魅力・見た目 ×1.2 / ファン獲得 ×1.15', lesson: { charm: 1.2, visual: 1.2 }, fan: 1.15 },
  };
  const STARTER_CARDS = ['senpai', 'manager'];

  const COMMANDS = {
    lesson_talk: { group: 'lesson', type: 'lesson', name: 'トーク練習', icon: '💬', abil: 'talk', sub: { charm: 0.25 }, stam: 14, ment: 2, tank: 15 },
    lesson_game: { group: 'lesson', type: 'lesson', name: 'ゲーム練習', icon: '🎮', abil: 'game', sub: { talk: 0.2 }, stam: 16, ment: 3, tank: 15 },
    lesson_song: { group: 'lesson', type: 'lesson', name: 'ボイトレ', icon: '🎤', abil: 'song', sub: { charm: 0.2 }, stam: 16, ment: 2, tank: 15 },
    lesson_visual: { group: 'lesson', type: 'lesson', name: '見た目・機材磨き', icon: '✨', abil: 'visual', sub: { charm: 0.25 }, stam: 12, ment: 1, tank: 20 },
    lesson_charm: { group: 'lesson', type: 'lesson', name: '魅力レッスン', icon: '💗', abil: 'charm', sub: { talk: 0.2, visual: 0.1 }, stam: 12, ment: 2, tank: 25 },

    stream_talk: { group: 'stream', type: 'stream', name: '雑談配信', icon: '💬', key: 'talk', fanMul: 1.0, risk: 0, stam: 10, ment: 6, tank: 10, greatMul: 2 },
    stream_game: { group: 'stream', type: 'stream', name: 'ゲーム実況', icon: '🎮', key: 'game', fanMul: 1.15, risk: 0.03, stam: 12, ment: 6, tank: 10, greatMul: 2 },
    stream_song: { group: 'stream', type: 'stream', name: '歌枠', icon: '🎤', key: 'song', fanMul: 1.1, risk: 0.03, stam: 12, ment: 5, tank: 10, greatMul: 2 },
    stream_bold: { group: 'stream', type: 'stream', name: 'ちょっと攻めた企画', icon: '🔥', key: 'charm', fanMul: 1.6, risk: 0.15, stam: 12, ment: 12, tank: 45, greatMul: 3 },

    rest: { group: 'other', type: 'rest', name: 'お休み', icon: '🌙', d: { stamina: +50, mental: +10 } },
    care: { group: 'other', type: 'care', name: 'ケア（クールダウン）', icon: '🍵', cost: 3000, d: { stamina: +10, mental: +25, happy: +10, love: +3, tank: -60 } },
    meet: { group: 'other', type: 'meet', name: '交流（ごはん・おでかけ）', icon: '🍽️', cost: 2000, d: { stamina: -8, happy: +8, love: +8, tank: +120 } },
  };

  // ---------- util ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rand(s) {
    s.seed = (s.seed + 0x6D2B79F5) >>> 0;
    let t = s.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(s, arr) { return arr[Math.floor(rand(s) * arr.length)]; }

  // ---------- state ----------
  function newGame(seed, cardIds, charId, modeId) {
    const ch = CHARS[charId] || CHARS.kotoha;
    return {
      seed: (seed >>> 0) || 1,
      charId: ch.id,
      mode: MODES[modeId] ? modeId : 'short',
      week: 1,
      money: CFG.startMoney,
      stamina: 100, mental: 100, happy: ch.happy, love: 0, tank: 0,
      subs: CFG.startSubs,
      abil: Object.assign({}, ch.abil),
      cards: (cardIds && cardIds.length ? cardIds : STARTER_CARDS).slice(0, 2),
      seenEvents: [], lastEvent: null, bursts: 0,
      history: [],
      over: null,
    };
  }
  function snapshot(s) {
    return { subs: s.subs, money: s.money, stamina: s.stamina, mental: s.mental, happy: s.happy, love: s.love, tank: s.tank, abil: Object.assign({}, s.abil) };
  }
  function diff(a, b) {
    const d = {};
    for (const k of ['subs', 'money', 'stamina', 'mental', 'happy', 'love', 'tank']) if (b[k] !== a[k]) d[k] = b[k] - a[k];
    for (const k of ABIL_KEYS) if (b.abil[k] !== a.abil[k]) d[k] = b.abil[k] - a.abil[k];
    return d;
  }
  function clampState(s) {
    s.stamina = clamp(s.stamina, 0, 100);
    s.mental = clamp(s.mental, 0, 100);
    s.happy = clamp(s.happy, 0, 100);
    s.love = clamp(s.love, 0, 100);
    s.tank = clamp(s.tank, 0, CFG.tankMax);
    s.money = Math.max(0, s.money);
    s.subs = Math.max(0, Math.round(s.subs));
    for (const k of ABIL_KEYS) s.abil[k] = clamp(Math.round(s.abil[k]), 0, 1000);
  }

  // ---------- modifiers ----------
  function condition(s) {
    if (s.happy >= 70 && s.mental >= 60) return { name: '調子◎', mult: 1.25 };
    if (s.mental < 30) return { name: '不調', mult: 0.7 };
    return { name: '普通', mult: 1.0 };
  }
  function cardLessonMul(s, abil) {
    let m = 1;
    for (const id of s.cards) {
      const l = CARDS[id].lesson || {};
      if (l.all) m *= l.all;
      if (l[abil]) m *= l[abil];
    }
    return m;
  }
  function cardFanMul(s) { return s.cards.reduce((m, id) => m * (CARDS[id].fan || 1), 1); }
  function cardIncomeMul(s) { return s.cards.reduce((m, id) => m * (CARDS[id].income || 1), 1); }
  const dim = v => clamp(1.15 - v / 1000, 0.3, 1.1);
  const staminaFail = s => (s.stamina >= 55 ? 0 : (55 - s.stamina) / 55 * 0.6);

  // ---------- preview / act ----------
  function preview(s, id, intenId) {
    const c = COMMANDS[id];
    const fixed = c.type === 'rest' || c.type === 'care' || c.type === 'meet';
    const I = INTENS[fixed ? 'normal' : (intenId || 'normal')];
    const cond = condition(s);
    const p = { id, name: c.name, type: c.type, inten: fixed ? 'normal' : (intenId || 'normal'), affordable: true, reason: '',
      gains: {}, fans: 0, income: 0, d: {}, failRate: 0, greatRate: 0, condName: cond.name };

    if (c.cost && s.money < c.cost) { p.affordable = false; p.reason = '資金不足'; }
    if (c.cost) p.d.money = -c.cost;

    if (fixed) {
      Object.assign(p.d, c.d);
      if (p.d.love > 0) p.d.love = Math.round(p.d.love * modOf(s, 'love'));
      if (p.d.tank > 0) p.d.tank = Math.round(p.d.tank * modOf(s, 'tankGain'));
      if (c.cost) p.d.money = -c.cost;
      return p;
    }

    p.d.stamina = -Math.round(c.stam * I.stam * modOf(s, 'stam'));
    p.d.mental = -Math.round(c.ment * modOf(s, 'ment'));
    p.d.tank = Math.round(c.tank * modOf(s, 'tankGain'));
    const sf = staminaFail(s);

    if (c.type === 'lesson') {
      const mult = cond.mult * cardLessonMul(s, c.abil) * modOf(s, 'lesson', c.abil) * modOf(s, 'lesson', 'all') * I.gain;
      p.gains[c.abil] = Math.round(CFG.lessonBase * dim(s.abil[c.abil]) * mult);
      for (const k of Object.keys(c.sub)) {
        p.gains[k] = Math.round(CFG.lessonBase * c.sub[k] * dim(s.abil[k]) * mult);
      }
      p.failRate = clamp(sf + I.fail, 0, 0.85);
      p.greatRate = 0.12 + s.happy / 600;
    } else {
      const power = 0.6 * s.abil[c.key] + 0.4 * s.abil.charm;
      p.fans = Math.round(power * CFG.fanScale * c.fanMul * cond.mult * cardFanMul(s) * modOf(s, 'fan') * modOf(s, 'streamFan', c.key) * I.gain);
      p.income = Math.round((200 + s.subs * 0.35 + p.fans * 0.8) * cardIncomeMul(s));
      const succ = clamp(0.75 + s.abil[c.key] / 1000 * 0.22 - c.risk, 0.3, 0.97);
      p.failRate = clamp(Math.max(1 - succ, sf) + I.fail, 0, 0.85);
      p.greatRate = clamp(0.10 + s.abil[c.key] / 2500, 0, 0.46);
      p.greatMul = c.greatMul;
    }
    return p;
  }

  // fixed=true: 既に予測値に倍率を反映済みのコマンド結果 (イベント効果には未反映なので掛ける)
  function applyDelta(s, d, applied) {
    for (const k of ['stamina', 'mental', 'happy', 'love', 'tank', 'money', 'subs']) {
      if (!d[k]) continue;
      let v = d[k];
      if (!applied && k === 'love' && v > 0) v = Math.round(v * modOf(s, 'love'));
      s[k] += v;
    }
    clampState(s);
  }

  function act(s, id, intenId) {
    const p = preview(s, id, intenId);
    if (!p.affordable) return { error: p.reason };
    const c = COMMANDS[id];
    const before = snapshot(s);
    const r = { id, name: c.name, fail: false, great: false };

    if (c.type === 'lesson' || c.type === 'stream') {
      r.fail = rand(s) < p.failRate;
      r.great = !r.fail && rand(s) < p.greatRate;
      const d = Object.assign({}, p.d);
      if (r.fail) { d.mental = (d.mental || 0) - 8; d.tank = Math.round(d.tank / 2); }
      if (r.great) d.happy = (d.happy || 0) + 3;
      if (c.type === 'lesson') {
        const f = r.fail ? 0.25 : r.great ? 1.5 : 1;
        for (const k of Object.keys(p.gains)) s.abil[k] += p.gains[k] * f;
      } else {
        const f = r.fail ? 0.25 : r.great ? p.greatMul : 1;
        d.subs = Math.round(p.fans * f);
        d.money = Math.round(p.income * (r.fail ? 0.3 : 1));
      }
      applyDelta(s, d, true);
    } else {
      applyDelta(s, p.d, true);
    }
    clampState(s);
    r.delta = diff(before, snapshot(s));
    return r;
  }

  // ---------- events ----------
  const EVENTS = [
    { id: 'collab_invite', title: '先輩からの深夜コラボ誘い', text: '人気配信者・桐生ミレイから「今夜、一緒にやらない？」とDMが届いた。',
      choices: [
        { tag: '応える', label: '乗る！', eff: { subs: 160, love: 5, tank: 70, mental: -8 }, result: '勢いで配信は大盛り上がり。期待値も一気に上がった。' },
        { tag: '受け流す', label: '日程を調整する', eff: { subs: 50, love: 2 }, result: '落ち着いて準備して、小さく成功。' },
        { tag: '断る', label: '今回は見送る', eff: { mental: 5, love: -2 }, result: '少しホッとしたが、チャンスを逃した気もする。' },
      ] },
    { id: 'fan_dm', title: 'ファンからの熱いDM', text: '「ずっと応援してます！」長文の応援メッセージが届いた。',
      choices: [
        { tag: '応える', label: '丁寧に返信する', eff: { happy: 10, subs: 40, tank: 30 }, result: '返信が話題になり、ファンの距離が縮まった。' },
        { tag: '受け流す', label: 'ハートだけ押す', eff: { happy: 3 }, result: '無難に対応した。' },
        { tag: '断る', label: '読まずに閉じる', eff: { happy: -4 }, result: '少し罪悪感が残った。' },
      ] },
    { id: 'gear_trouble', title: '機材トラブル', text: 'マイクが突然ノイズだらけに。配信まであとわずか。',
      choices: [
        { tag: '応える', label: '自腹で買い替える', eff: { money: -5000, mental: 4, abil: { visual: 12 } }, result: '新品で音質アップ。出費は痛いが前向きに。' },
        { tag: '受け流す', label: '応急処置で乗り切る', eff: { mental: -6 }, result: 'なんとかなったが、ひやひやした。' },
        { tag: '断る', label: '今日は中止にする', eff: { subs: -40, mental: 3 }, result: '視聴者は残念がった。' },
      ] },
    { id: 'superchat', title: 'スパチャ祭り', text: '配信中、突然高額のスーパーチャットが連投され始めた！',
      choices: [
        { tag: '応える', label: '全力でお礼配信', eff: { money: 12000, subs: 120, stamina: -15, tank: 40 }, result: '感謝の気持ちが伝わり、さらに盛り上がった。' },
        { tag: '受け流す', label: '軽くお礼を言う', eff: { money: 6000, subs: 40 }, result: '平穏に終わった。' },
        { tag: '断る', label: '次回から上限を設定', eff: { money: 2000, mental: 5 }, result: '健全運営を選んだ。' },
      ] },
    { id: 'clip_viral', title: '切り抜きがバズった', text: '昨日の配信の切り抜きが急に拡散されている。',
      choices: [
        { tag: '応える', label: '便乗して即配信', eff: { subs: 300, stamina: -18, mental: -6, tank: 50 }, result: '流入が大きく増えた。' },
        { tag: '受け流す', label: '様子を見る', eff: { subs: 120 }, result: '自然な増加で落ち着いた。' },
        { tag: '断る', label: '無視して休む', eff: { subs: 40, stamina: 10 }, result: '体力を温存した。' },
      ] },
    { id: 'afterparty', title: '二人きりの打ち上げ', text: '配信が成功した夜、{n}が「少しだけ、話せませんか」と誘ってきた。', minLove: 25,
      choices: [
        { tag: '応える', label: '付き合う', slot: 'afterparty_accept', eff: { love: 12, happy: 12, tank: 80, stamina: -10 }, result: '距離が一気に縮まった夜になった。' },
        { tag: '受け流す', label: 'みんなで打ち上げに変更', eff: { love: 4, happy: 6 }, result: '和やかな時間を過ごした。' },
        { tag: '断る', label: '仕事を理由に帰る', eff: { love: -4, mental: 4 }, result: '{n}は少し寂しそうだった。' },
      ] },
    { id: 'anti_comment', title: 'アンチコメント', text: '配信に心ない言葉が書き込まれ、{n}の表情が曇る。',
      choices: [
        { tag: '応える', label: 'そばで励ます', eff: { mental: 6, love: 6, stamina: -6 }, result: '二人の信頼が深まった。' },
        { tag: '受け流す', label: 'コメントを非表示に', eff: { mental: -4 }, result: '対処はしたが、後味は悪い。' },
        { tag: '断る', label: '気にするなと言う', eff: { mental: -12, love: -3 }, result: '気持ちは救われなかった。' },
      ] },
    { id: 'sleepy', title: '体調不良のサイン', text: '{n}の目の下にクマが出ている。無理をさせすぎたかもしれない。', cond: s => s.stamina < 45,
      choices: [
        { tag: '応える', label: '今すぐ休ませる', eff: { stamina: 25, mental: 8, happy: 4 }, result: '回復して、表情が戻った。' },
        { tag: '受け流す', label: '少しだけ様子を見る', eff: { stamina: 5 }, result: '微妙な回復にとどまった。' },
        { tag: '断る', label: '頑張ってもらう', eff: { stamina: -10, mental: -10, subs: 80 }, result: 'ファンは増えたが、無理が祟った。' },
      ] },
    { id: 'sponsor', title: '企業案件のオファー', text: '企業から商品紹介の案件が届いた。条件は少し厳しい。', minWeek: 3,
      choices: [
        { tag: '応える', label: '全力で受ける', eff: { money: 15000, subs: 90, stamina: -14, mental: -6 }, result: '報酬と露出を得たが、かなり消耗した。' },
        { tag: '受け流す', label: '条件交渉する', eff: { money: 7000, subs: 40 }, result: '無理のない条件でまとまった。' },
        { tag: '断る', label: '丁重に辞退', eff: { mental: 4 }, result: '自分たちのペースを守った。' },
      ] },
    { id: 'accident', title: '放送事故', text: '配信中に画面共有の設定ミスで、見せるつもりのない画面が映ってしまった！',
      choices: [
        { tag: '応える', label: '笑いに変えて謝る', eff: { subs: 140, mental: -6, tank: 40 }, result: '神対応と話題になり、切り抜きが拡散された。' },
        { tag: '受け流す', label: '淡々と謝罪する', eff: { subs: -20, mental: -4 }, result: '大事にはならなかった。' },
        { tag: '断る', label: '配信を切る', eff: { subs: -90, mental: -10 }, result: '憶測を呼び、少し荒れた。' },
      ] },
    { id: 'rival', title: 'ライバル配信者の挑発', text: '同期のライバルが「次のイベント、どっちが上か勝負しよう」と宣戦布告してきた。', minWeek: 3,
      choices: [
        { tag: '応える', label: '受けて立つ', eff: { subs: 120, tank: 90, mental: -8, happy: 4 }, result: '対決企画が話題になり、期待値が高まった。' },
        { tag: '受け流す', label: 'ほどほどに返す', eff: { subs: 30, tank: 20 }, result: '穏やかに流した。' },
        { tag: '断る', label: '相手にしない', eff: { happy: 3, subs: -20 }, result: '大人の対応…だが少し物足りない。' },
      ] },
    { id: 'fan_meeting', title: 'ファンミーティングの打診', text: '小規模なオフ会イベントを開かないか、とファンクラブから提案があった。', minWeek: 4,
      choices: [
        { tag: '応える', label: '開催する', eff: { subs: 200, money: -6000, happy: 10, stamina: -12, love: 3 }, result: 'ファンとの距離が縮まり、結束が強まった。' },
        { tag: '受け流す', label: '配信上で企画する', eff: { subs: 60, happy: 4 }, result: '手軽に実施できた。' },
        { tag: '断る', label: '時期尚早と伝える', eff: { stamina: 6 }, result: '準備に専念することにした。' },
      ] },
    { id: 'birthday', title: '誕生日配信', text: '今日は{n}の誕生日。ファンが盛大に祝ってくれそうだ。', minWeek: 2,
      choices: [
        { tag: '応える', label: 'サプライズを用意する', eff: { money: -3000, happy: 18, love: 8, subs: 110 }, result: '涙ぐむ{n}。最高の誕生日配信になった。' },
        { tag: '受け流す', label: 'ケーキだけ贈る', eff: { happy: 8, love: 3 }, result: '素朴だけど温かい時間になった。' },
        { tag: '断る', label: '特に何もしない', eff: { happy: -6, love: -3 }, result: '{n}は少し寂しそうにしていた。' },
      ] },
    { id: 'fan_art', title: 'ファンアートが届いた', text: '素敵なファンアートがSNSに投稿され、{n}が大喜びしている。',
      choices: [
        { tag: '応える', label: '配信で紹介する', eff: { happy: 10, subs: 70 }, result: 'ファンとの温かい交流が生まれた。' },
        { tag: '受け流す', label: 'いいねだけ押す', eff: { happy: 4 }, result: 'ささやかな喜びを味わった。' },
        { tag: '断る', label: '権利面が心配なので控える', eff: { mental: 2 }, result: '慎重に対応した。' },
      ] },
    { id: 'sns_flame', title: 'SNSで小さな炎上', text: '過去の発言が切り取られ、ちょっとした騒ぎになっている。',
      choices: [
        { tag: '応える', label: '正面から説明配信', eff: { subs: 30, mental: -10, tank: -80, stamina: -8 }, result: '誠実な対応で収まり、熱も冷めた。' },
        { tag: '受け流す', label: '静観する', eff: { subs: -50, tank: -30 }, result: '時間とともに沈静化した。' },
        { tag: '断る', label: '強く反論する', eff: { subs: -120, mental: -12, tank: 50 }, result: '火に油を注いでしまった。' },
      ] },
    { id: 'rainy_day', title: '雨の日の帰り道', text: '帰り際に雨が降ってきた。{n}が傘を忘れたと困っている。', minLove: 15,
      choices: [
        { tag: '応える', label: '傘を差しかける', eff: { love: 7, happy: 6 }, result: '少し照れながら、二人で並んで歩いた。' },
        { tag: '受け流す', label: 'タクシーを呼ぶ', eff: { money: -2000, happy: 3, love: 2 }, result: '無難に解決した。' },
        { tag: '断る', label: 'コンビニで買うよう促す', eff: { love: -2 }, result: '{n}は苦笑いを浮かべた。' },
      ] },
    { id: 'late_night', title: '深夜の相談', text: '配信後の夜、{n}がぽつりと「将来が不安で」と打ち明けてきた。', minLove: 40,
      choices: [
        { tag: '応える', label: '朝まで話を聞く', slot: 'late_night_accept', eff: { love: 10, mental: 12, stamina: -12 }, result: '心の距離が一気に縮まった夜だった。' },
        { tag: '受け流す', label: '「大丈夫」と励ます', eff: { love: 3, mental: 4 }, result: '少しだけ安心した様子だった。' },
        { tag: '断る', label: '明日に回す', eff: { love: -4, mental: -6 }, result: '{n}は黙って俯いてしまった。' },
      ] },
    { id: 'promise', title: '「これからも、そばで」', text: '大きな節目を前に、{n}が真剣な表情で「これからも、一緒に頑張ってくれますか」と尋ねてきた。', minLove: 65,
      choices: [
        { tag: '応える', label: '「もちろん」と約束する', slot: 'promise_accept', eff: { love: 12, happy: 15, mental: 10 }, result: '{n}は嬉しそうに微笑んだ。絆が確かなものになった。' },
        { tag: '受け流す', label: '「まずは目標を達成しよう」', eff: { love: 3, happy: 3 }, result: '前向きな空気のまま、次へ向かう。' },
        { tag: '断る', label: '仕事の関係だと線を引く', eff: { love: -10, mental: -8 }, result: '{n}は静かに頷いた。' },
      ] },
    // ---- 長編 (24週) 専用 ----
    { id: 'slump', title: 'マンネリの壁', minWeek: 13, text: '同じことの繰り返しで、{n}の配信にも新鮮味がなくなってきた。視聴者数が伸び悩んでいる。',
      choices: [
        { tag: '応える', label: '企画を総入れ替えする', eff: { subs: 150, mental: -10, stamina: -10, tank: 40 }, result: '思い切った刷新で、再び熱量が戻ってきた。' },
        { tag: '受け流す', label: '少しだけテコ入れ', eff: { subs: 40, happy: 2 }, result: '小さな工夫で踏みとどまった。' },
        { tag: '断る', label: '今のスタイルを貫く', eff: { subs: -60, happy: -4 }, result: '数字は少し落ちたが、軸は守った。' },
      ] },
    { id: 'tour_offer', title: '全国ツアーの打診', minWeek: 14, text: '大手イベント会社から、地方都市を回る小規模ツアーの打診が届いた。',
      choices: [
        { tag: '応える', label: 'フルで受ける', eff: { subs: 420, money: 8000, stamina: -22, mental: -10, tank: 90 }, result: '各地で熱烈に迎えられ、一気に知名度が上がった。' },
        { tag: '受け流す', label: '数公演だけ参加', eff: { subs: 180, money: 3000, stamina: -8 }, result: '無理のない範囲で成果を出した。' },
        { tag: '断る', label: '配信中心を続ける', eff: { mental: 5, stamina: 6 }, result: '地道に足元を固めることにした。' },
      ] },
    { id: 'junior_advice', title: '後輩からの相談', minWeek: 15, text: '新人の後輩配信者が、{n}に「どうやって続けてるんですか」と相談に来た。',
      choices: [
        { tag: '応える', label: '時間を作って向き合う', eff: { happy: 12, love: 4, stamina: -8, subs: 60 }, result: '後輩の成長を見守る{n}の表情は、頼もしかった。' },
        { tag: '受け流す', label: 'コラボ配信で教える', eff: { subs: 120, happy: 5 }, result: '二人の配信が好評を博した。' },
        { tag: '断る', label: '今は忙しいと断る', eff: { happy: -5, mental: -3 }, result: '少し後味の悪さが残った。' },
      ] },
    // ---- キャラ固有 ----
    { id: 'ren_cover', title: '「歌ってみた」の依頼', chars: ['ren'], text: '人気ボカロPから、新曲のカバーを歌ってほしいと依頼が来た。',
      choices: [
        { tag: '応える', label: '全力で挑戦', eff: { subs: 220, abil: { song: 25 }, mental: -10, tank: 60 }, result: '渾身の歌声が大反響を呼んだ。' },
        { tag: '受け流す', label: 'アレンジして投稿', eff: { subs: 80, abil: { song: 10 } }, result: '自分らしいカバーに仕上がった。' },
        { tag: '断る', label: '練習不足なので見送る', eff: { mental: 5 }, result: '次の機会に備えることにした。' },
      ] },
    { id: 'ren_fright', title: 'ステージ前の震え', chars: ['ren'], text: '大舞台を前に、{n}の手が小刻みに震えている。',
      choices: [
        { tag: '応える', label: '手を握って励ます', eff: { mental: 15, love: 6, stamina: -4 }, result: '深呼吸して、少し落ち着いた。' },
        { tag: '受け流す', label: '好きな曲を一緒に聴く', eff: { mental: 8, happy: 6 }, result: '少し表情が和らいだ。' },
        { tag: '断る', label: '「慣れだよ」と言う', eff: { mental: -10 }, result: '余計に緊張させてしまった。' },
      ] },
    { id: 'mio_tourney', title: '元プロとしての大会招待', chars: ['mio'], text: '往年のライバルから、エキシビション大会への招待状が届いた。',
      choices: [
        { tag: '応える', label: '出場する', eff: { subs: 260, abil: { game: 25 }, stamina: -15, tank: 80 }, result: '圧巻のプレイで会場が沸いた。' },
        { tag: '受け流す', label: 'ゲスト解説だけ引き受ける', eff: { subs: 100, money: 6000 }, result: '落ち着いた立ち回りで評価された。' },
        { tag: '断る', label: '配信者としての道を優先', eff: { mental: 5, happy: 4 }, result: '迷いなく、今の道を選んだ。' },
      ] },
    { id: 'mio_awkward', title: '不器用なお礼', chars: ['mio'], text: '{n}が言葉を探しながら「…その、いつも助かってる」とぼそっと言った。',
      choices: [
        { tag: '応える', label: '「こちらこそ」と返す', eff: { love: 9, happy: 8 }, result: '照れた顔を、初めて見た。' },
        { tag: '受け流す', label: 'うなずくだけにする', eff: { love: 4, happy: 3 }, result: '静かで穏やかな空気が流れた。' },
        { tag: '断る', label: '茶化す', eff: { love: -4, mental: -4 }, result: '{n}はそっぽを向いてしまった。' },
      ] },
    { id: 'chisato_collab', title: 'アパレルブランドのコラボ', chars: ['chisato'], text: '古巣のブランドから、コラボ衣装の企画が持ち込まれた。',
      choices: [
        { tag: '応える', label: '全面的に協力', eff: { subs: 240, money: 12000, abil: { visual: 20 }, tank: 70, stamina: -12 }, result: 'ファッション界隈でも話題になった。' },
        { tag: '受け流す', label: 'ワンポイントだけ', eff: { subs: 90, money: 4000 }, result: '手堅く成果を残した。' },
        { tag: '断る', label: '配信に集中する', eff: { mental: 4 }, result: '地道に積み上げる道を選んだ。' },
      ] },
    { id: 'chisato_viral', title: '勢いで投稿したら…', chars: ['chisato'], text: '{n}が深夜のテンションで投稿した動画が、ものすごい勢いで拡散している。',
      choices: [
        { tag: '応える', label: '便乗して追撃配信', eff: { subs: 320, tank: 110, stamina: -16, mental: -8 }, result: '大バズり。ただし期待値が危険水域に。' },
        { tag: '受け流す', label: '様子を見る', eff: { subs: 130, tank: 40 }, result: '穏やかに増加した。' },
        { tag: '断る', label: '削除させる', eff: { subs: -40, tank: -60, mental: -4 }, result: '騒ぎは収まったが惜しい気持ちも残った。' },
      ] },
  ];

  function drawEvent(s) {
    if (rand(s) > 0.75) return null;
    const recent = s.seenRecent || [];
    const pool = EVENTS.filter(e => !recent.includes(e.id) &&
      (!e.minLove || s.love >= e.minLove) && (!e.minWeek || s.week >= e.minWeek) &&
      (!e.chars || e.chars.includes(s.charId || 'kotoha')) && (!e.cond || e.cond(s)));
    if (!pool.length) return null;
    const e = pick(s, pool);
    s.lastEvent = e.id;
    s.seenRecent = recent.concat(e.id).slice(-modeOf(s).recentWindow); // 直近N件は再出現しない
    return { id: e.id, title: fmt(s, e.title), text: fmt(s, e.text),
      choices: e.choices.map(c => Object.assign({}, c, { label: fmt(s, c.label), result: fmt(s, c.result) })) };
  }
  function chooseEvent(s, ev, idx) {
    const ch = ev.choices[idx];
    const before = snapshot(s);
    const eff = ch.eff || {};
    applyDelta(s, eff, false);
    if (eff.abil) for (const k of Object.keys(eff.abil)) s.abil[k] += eff.abil[k];
    clampState(s);
    const key = ev.id + ':' + idx;
    if (!s.seenEvents.includes(key)) s.seenEvents.push(key);
    return { text: ch.result, slot: ch.slot || null, delta: diff(before, snapshot(s)) };
  }

  // ---------- week end / live ----------
  function runLive(s) {
    const M = modeOf(s);
    const idx = M.liveWeeks.indexOf(s.week);
    const tier = tankTier(s.tank);
    const bonus = tankLiveBonus(s.tank);
    const avg = ABIL_KEYS.reduce((a, k) => a + s.abil[k], 0) / ABIL_KEYS.length;
    const base = avg * CFG.liveScale * M.stageMul[idx] * condition(s).mult * cardFanMul(s) * modOf(s, 'fan');
    const gain = Math.round(base * (1 + bonus));
    const usedTank = s.tank;
    s.subs += gain;
    s.tank = Math.round(s.tank * 0.1);
    const target = M.targets[s.week];
    return { stage: M.stageNames[s.week], tier, bonus, gain, usedTank, target, pass: s.subs >= target, subs: s.subs };
  }

  function finishWeek(s) {
    const M = modeOf(s);
    const rep = { burst: null, passive: 0, live: null, over: null };
    const end = (id, name, text) => ({ id, name, text: fmt(s, text) });
    // 炎上チェック
    if (rand(s) < burstChance(s.tank, s)) {
      const lost = Math.round(s.subs * 0.06);
      s.subs -= lost; s.mental -= 15; s.bursts++;
      rep.burst = { tank: s.tank, lostSubs: lost };
      s.tank = 0;
    }
    clampState(s);
    // 自然増
    rep.passive = Math.round(s.subs * 0.03 * (0.5 + s.happy / 100));
    s.subs += rep.passive;
    // ライブ
    if (M.liveWeeks.includes(s.week)) {
      rep.live = runLive(s);
      if (!rep.live.pass) rep.over = end('midway', '途中卒業', '目標登録者数に届かず、{n}は事務所を去ることになった…');
    }
    clampState(s);
    if (!rep.over && s.mental <= 0) rep.over = end('burnout', '燃え尽き引退', '心が限界を迎え、{n}は配信を辞めてしまった。');
    s.history.push({ week: s.week, subs: s.subs });
    if (!rep.over) {
      if (s.week >= M.weeks) {
        if (s.subs >= M.legendSubs) rep.over = end('legend', '伝説の卒業', '登録者は大台に。最後に{n}から届いた手紙には「マネージャーのおかげです」とあった。');
        else if (s.love >= M.duoLove) rep.over = end('duo', '二人三脚エンド', '独立後も、{n}の隣にはあなたがいた。');
        else rep.over = end('graduate', '卒業', '目標を達成し、{n}は次のステージへ旅立った。');
      } else {
        s.week++;
      }
    }
    if (rep.over) s.over = rep.over;
    return rep;
  }

  function cardFromEnding(over, charId) {
    return over && (over.id === 'legend' || over.id === 'graduate' || over.id === 'duo') ? 'grad_' + (charId || 'kotoha') : null;
  }
  // キャラ解放: 前のキャラでクリア済みなら解放
  function isUnlocked(charId, cleared) {
    const u = CHARS[charId].unlock;
    return !u || !!(cleared && cleared[u]);
  }


  // ---------- 素材スロット一覧 (UI と tools/assets.js が共用) ----------
  // key = assets/ 以下の任意フォルダに置くファイル名 (拡張子なし)。png/webp/jpg/svg/gif = 画像、mp4/webm = 動画。
  const ENDING_IDS = ['legend', 'duo', 'graduate', 'midway', 'burnout'];
  const ENDING_NAMES = { legend: '伝説の卒業', duo: '二人三脚', graduate: '卒業', midway: '途中卒業', burnout: '燃え尽き' };
  function listSlots() {
    const L = [];
    const add = (key, group, label, ratio) => L.push({ key, group, label, ratio: ratio || '16:9' });
    CHAR_IDS.forEach(id => {
      const n = CHARS[id].name;
      add('portrait_' + id, '立ち絵', n + ' / 通常', '3:4');
      add('portrait_' + id + '_good', '立ち絵', n + ' / 調子◎ (任意)', '3:4');
      add('portrait_' + id + '_bad', '立ち絵', n + ' / 不調 (任意)', '3:4');
    });
    EVENTS.forEach(e => add('event_' + e.id, 'イベント絵 (任意)', e.title.replace(/{n}/g, 'キャラ') + (e.chars ? ' [' + e.chars.map(c => CHARS[c].short).join(',') + ']' : '')));
    EVENTS.forEach(e => e.choices.forEach(c => { if (c.slot) add(c.slot, '特別演出', e.title.replace(/{n}/g, 'キャラ') + ' ─ ' + c.tag); }));
    MODES.long.liveWeeks.forEach(w => {
      const a = MODES.short.stageNames[w], b = MODES.long.stageNames[w];
      add('live_' + w, 'ライブ演出 (任意)', (a && a !== b ? a + ' / ' : '') + b + ' (' + w + '週目)');
    });
    CHAR_IDS.forEach(id => ENDING_IDS.forEach(o => add('ending_' + id + '_' + o, 'エンディング', CHARS[id].name + ' / ' + ENDING_NAMES[o])));
    return L;
  }

  return { listSlots, CFG, MODES, modeOf, CHARS, CHAR_IDS, ABILITIES, ABIL_KEYS, RANKS, rankOf, TANK_TIERS, tankTier, tankLiveBonus, burstChance, INTENS, CARDS, STARTER_CARDS,
    COMMANDS, EVENTS, newGame, preview, act, drawEvent, chooseEvent, finishWeek, condition, cardFromEnding, isUnlocked, fmt, rand, snapshot, diff };
});
