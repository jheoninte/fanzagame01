// node sim.js [runs]  -- バランス検証用ボット
const C = require('./core.js');
const N = Number(process.argv[2]) || 2000;

const lessons = ['lesson_talk', 'lesson_game', 'lesson_song', 'lesson_visual', 'lesson_charm'];
const streams = ['stream_talk', 'stream_game', 'stream_song', 'stream_bold'];
const liveIn = s => C.modeOf(s).liveWeeks.find(w => w >= s.week) - s.week; // 次のライブまでの週数

const bots = {
  random(s) {
    const ids = Object.keys(C.COMMANDS);
    return [ids[Math.floor(C.rand(s) * ids.length)], 'normal'];
  },
  // 体力管理しつつ 練習→配信。タンクは使わない
  steady(s) {
    if (s.stamina < 35) return ['rest', 'normal'];
    if (s.mental < 35) return ['care', 'normal'];
    const need = liveIn(s);
    if (need <= 1 || s.week % 2 === 0) return [streams[Math.floor(C.rand(s) * 3)], 'normal'];
    return [lessons[Math.floor(C.rand(s) * 5)], 'normal'];
  },
  // タンクを溜めてライブで爆発させる
  hold(s) {
    if (s.stamina < 35) return ['rest', 'normal'];
    if (s.mental < 35) return ['care', 'normal'];
    const need = liveIn(s);
    if (need === 0 && s.tank > 450) return ['stream_talk', 'normal']; // 最後は放出前に安全運転
    if (need <= 2 && s.tank < 450 && s.money >= 2000) return ['meet', 'normal'];
    if (need <= 1) return ['stream_bold', 'normal'];
    if (s.week % 3 === 0) return [streams[Math.floor(C.rand(s) * 3)], 'normal'];
    return [lessons[Math.floor(C.rand(s) * 5)], 'full'];
  },
  // 全力+ハイリスク重視
  greedy(s) {
    if (s.stamina < 40) return ['rest', 'normal'];
    if (s.mental < 30) return ['care', 'normal'];
    if (s.week % 2 === 0) return ['stream_bold', 'risky'];
    return [lessons[Math.floor(C.rand(s) * 5)], 'risky'];
  },
};

function run(botName, seed, charId, modeId) {
  const s = C.newGame(seed, null, charId, modeId);
  const bot = bots[botName];
  const liveSubs = {};
  let guard = 0;
  while (!s.over && guard++ < 200) {
    const [id, inten] = bot(s);
    const r = C.act(s, id, inten);
    if (r.error) { C.act(s, 'rest'); }
    const ev = C.drawEvent(s);
    if (ev) C.chooseEvent(s, ev, Math.floor(C.rand(s) * 3));
    const w = s.week;
    const rep = C.finishWeek(s);
    if (rep.live) liveSubs[w] = rep.live;
  }
  return { s, liveSubs };
}

const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
const MODE = process.argv[4] || 'short';
const LIVES = C.MODES[MODE].liveWeeks;
for (const charId of C.CHAR_IDS) for (const name of Object.keys(bots)) {
  if (only && only !== charId) continue;
  const ends = {};
  const liveAvg = {}; LIVES.forEach(w => (liveAvg[w] = []));
  let bursts = 0, subs = 0;
  for (let i = 1; i <= N; i++) {
    const { s, liveSubs } = run(name, i * 7919, charId, MODE);
    ends[s.over.id] = (ends[s.over.id] || 0) + 1;
    bursts += s.bursts; subs += s.subs;
    for (const w of Object.keys(liveSubs)) liveAvg[w].push(liveSubs[w].subs);
  }
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-');
  const pct = k => ((ends[k] || 0) / N * 100).toFixed(1) + '%';
  console.log(`${charId.padEnd(7)}[${name.padEnd(6)}] clear=${((N - (ends.midway || 0) - (ends.burnout || 0)) / N * 100).toFixed(1)}%  ` +
    `legend=${pct('legend')} graduate=${pct('graduate')} duo=${pct('duo')} midway=${pct('midway')} burnout=${pct('burnout')}  ` +
    `live(avg) ${LIVES.map(w => 'w' + w + '=' + avg(liveAvg[w])).join(' ')}  burst/run=${(bursts / N).toFixed(2)}`);
}
