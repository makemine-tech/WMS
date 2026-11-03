/* 비젬 도우미 (main/bizem_helper.js) — 가짜 화면으로 시험 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const SRC = fs.readFileSync(__dirname + '/../../main/bizem_helper.js', 'utf8');

function page(fields, reply) {
  const calls = { fetch: [], click: 0 };
  const form = { querySelector: (q) => (q === 'input[type=text]' ? fields.id : /captcha/.test(q) ? fields.captcha || null : null), querySelectorAll: () => [] };
  if (fields.pw) fields.pw.form = form;
  const doc = { querySelector: (q) => (q === 'input[type=password]' ? fields.pw || null : null), getElementById: (i) => (i === 'btnLogOn' ? fields.btn || null : null) };
  const heard = [];
  const win = { location: { hostname: 'partner.bizesm.com' }, document: doc, addEventListener: (n, f) => heard.push(f), removeEventListener() {}, alert() {}, opener: null, setTimeout, clearTimeout, Promise, JSON };
  win.window = win;
  win.fetch = async (u) => { calls.fetch.push(u); return { text: async () => reply }; };
  vm.runInNewContext(SRC, Object.assign(win, { RegExp, Object, String, Number, Array, Error }));
  const send = (cmd, args, origin) => new Promise((res) => {
    const source = { postMessage: (m) => res(m) };
    heard[0]({ data: { to: 'bizem-helper', id: 1, cmd, args }, origin: origin || 'https://makewon.com', source });
    setTimeout(() => res(null), 30);
  });
  return { win, send, calls };
}

test('건수: 주문확정 대기와 운송장인쇄 대기만 돌려줌', async () => {
  const p = page({}, '([{"TRNSPRT_STTUS_SE":"A10","CNT":"5","ORDRR_NM":"홍길동"},{"TRNSPRT_STTUS_SE":"B10","CNT":3},{"TRNSPRT_STTUS_SE":"C10","CNT":9}])');
  const m = await p.send('counts', {});
  assert.strictEqual(JSON.stringify(m.data), '{"unconfirmed":5,"printWait":3}');
  assert.ok(!JSON.stringify(m).includes('홍길동'));
  assert.deepStrictEqual(p.calls.fetch, ['/api/WorkFlow/GetWorkflowOrderCounts']);
});

test('건수가 없으면 0, 빈 응답 ([]) 도 로그인된 것으로 봄', async () => {
  const p = page({}, '([])');
  assert.strictEqual(JSON.stringify((await p.send('counts', {})).data), '{"unconfirmed":0,"printWait":0}');
  assert.strictEqual((await p.send('ping', {})).data.login, true);
});

test('로그인 판단: 비밀번호 칸이 있거나 응답이 HTML 이면 로그아웃', async () => {
  let p = page({ pw: { value: '' } }, '([])');
  assert.strictEqual((await p.send('ping', {})).data.login, false);
  assert.deepStrictEqual(p.calls.fetch, []);
  p = page({}, '<html>로그인</html>');
  const m = (await p.send('ping', {})).data;
  assert.strictEqual(m.login, false);
  assert.strictEqual(m.checked, true);
});

test('정해진 명령과 정해진 주소의 요청만 받음', async () => {
  const p = page({}, '([])');
  assert.strictEqual(await p.send('counts', {}, 'https://evil.example'), null);
  for (const bad of ['commit', 'save', 'click', 'constructor', 'toString']) assert.strictEqual(await p.send(bad, {}), null, bad);
  assert.ok((await p.send('counts', {})).ok);
});

test('로그인: 칸을 채우고 버튼을 한 번 누르며 값을 돌려주지 않음, 추가 인증이면 멈춤', async () => {
  let clicks = 0;
  const f = { id: { value: '' }, pw: { value: '기본값' }, btn: { click() { clicks++; } } };
  const p = page(f, '([])');
  const m = await p.send('login', { id: 'me', pw: 'p@ss비밀' });
  assert.strictEqual(JSON.stringify(m.data), '{"tried":true}');
  assert.strictEqual(f.pw.value, 'p@ss비밀');
  assert.strictEqual(f.id.value, 'me');
  await new Promise((d) => setTimeout(d, 350));
  assert.strictEqual(clicks, 1);
  clicks = 0;
  const g = { id: { value: '' }, pw: { value: '' }, btn: { click() { clicks++; } }, captcha: {} };
  const q = page(g, '([])');
  const r = await q.send('login', { id: 'me', pw: 'x' });
  assert.strictEqual(r.data.tried, false);
  assert.strictEqual(g.pw.value, '');
  await new Promise((d) => setTimeout(d, 350));
  assert.strictEqual(clicks, 0);
});

test('도우미 코드에 확정·삭제·다운로드 버튼이 없음', () => {
  for (const id of ['btnSave', 'btnDel', 'preexcelFormDownload', 'xlsDownload']) assert.ok(!SRC.includes(id), id);
});
