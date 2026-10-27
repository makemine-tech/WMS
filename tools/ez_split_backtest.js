/* 곡물도감 합포 분할 — 실데이터 맞춰 보기 (일회성 확인용, 2026-10-27)
   node tools/ez_split_backtest.js rows.json boxes.json
     rows.json  = 이지어드민 DG00 줄 배열 (ez_helper.js read 의 rows 와 같은 꼴, 수령자 이름은 빼고)
     boxes.json = 피킹이지 박스 기록 { boxKey: '45', … }
   「기존대로」를 찾은 비율, 확인 필요 건수, 막대 양 끝·기존대로 송장 수를 찍는다. */
const fs = require('fs');
const Z = require('../main/ez_split_calc.js');
const FEE = require('../main/p9_fee.js');

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const boxes = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const ctx = { boxes, fee: FEE, settings: { ship: { 15: 0, 30: 0, 45: 0, 60: 0 }, sec: { single: 20, mix2: 60, mix3: 90 } }, times: {} };

const orders = Z.buildOrders(rows);
const split = orders.filter(Z.canSplit);
const flags = {};
orders.forEach(o => o.flags.forEach(f => { flags[f] = (flags[f] || 0) + 1; }));
const ex = Z.planExisting(orders, ctx);
const warns = {};
orders.forEach(o => (o.warn || []).forEach(w => { warns[w] = (warns[w] || 0) + 1; }));
const steps = Z.buildSteps(orders, ctx);

/* 기록에 없는 구성 (자주 나오는 순) */
const missing = {};
split.filter(o => (o.warn || []).includes('new')).forEach(o => {
  const k = o.lines.map(l => l.prd.replace(' [곡물도감]', '') + '×' + l.qty).join(' + ');
  missing[k] = (missing[k] || 0) + 1;
});

console.log('주문', orders.length, '· 나눌 수 있는 주문', split.length, '· 확인 필요', JSON.stringify(flags));
console.log('기존대로 찾음', split.length - (warns.new || 0) - (warns.toomany || 0), '/', split.length, '· 경고', JSON.stringify(warns));
console.log('송장 수: 전부 분리', Z.planAt(orders, steps, 0, ctx).totals.count,
  '· 기존대로', ex.totals.count, '· 전부 합포', Z.planAt(orders, steps, steps.length, ctx).totals.count, '· 막대 눈금', steps.length);
console.log('기록에 없는 구성:');
Object.entries(missing).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + n + '건  ' + k));
