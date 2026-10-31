/* 이지어드민 도우미 (main/ez_helper.js) — 확정(commit) 경로를 가짜 이지어드민 화면에서 시험
   진짜 「일괄합포제외」를 누르지 않고, 이지어드민이 $.post 를 부르는 여러 모양을 흉내 낸다 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../../main/ez_helper.js', 'utf8');

/* post(url, data, cb, dataType) 를 받아 이지어드민 버튼이 하는 일을 흉내 내는 가짜 화면 */
function fakePage(onClick, extra){
  const el = () => ({ style: {}, set innerHTML(v){}, remove(){}, appendChild(){}, querySelector(){ return null; } });
  const btn = { click(){ onClick(win); } };
  extra = extra || {};
  const doc = { body: el(), head: el(), createElement: el,
                getElementById: id => extra[id] || (id === 'divide_pack_all' ? btn : id === 'grid1' ? el() : null),
                querySelector: q => extra[q] || null, querySelectorAll: () => [] };
  const jq = function(){ return { getGridParam(){ return 0; } }; };
  jq.post = function(){ throw new Error('원래 $.post 가 바뀌지 않음'); };
  const win = { location: { hostname: 'ga89.ezadmin.co.kr', search: '?template=DG00' }, document: doc, jQuery: jq, $: jq,
                alert(){}, confirm(){ return false; }, open(){ return null; }, opener: null,
                addEventListener(){}, removeEventListener(){}, setTimeout, clearTimeout, Promise, JSON,
                getComputedStyle: e => ({ display: e.style.display || 'block' }) };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return win;
}
/* 이지어드민 쪽 $.post 흉내: 서버가 resp 를 돌려준 것처럼 콜백을 부름 */
function serverReplies(win, resp, opts){
  return function(){
    if (!win.confirm('일괄합포제외 하시겠습니까?')) return;
    const data = opts && opts.stringData ? 'template=DG00&action=drop_pack_all&info_all=x' : { template: 'DG00', action: 'drop_pack_all', info_all: 'x' };
    win.jQuery.post('function.htm', data, opts && opts.cbThrows ? function(){ throw new Error('페이지 이동'); } : function(){}, opts && opts.dataType);
  };
}
function realPost(resp){ return function(url, data, cb){ cb(resp); }; }

test('확정: 문자열 응답을 읽어 돌려줌', async () => {
  let win; win = fakePage(w => serverReplies(w)());
  win.jQuery.post = realPost('{"error":0,"fail_list":[]}');
  const r = await win.__mkwEzHelper.commit({ auto: true });
  assert.deepStrictEqual({ error: r.error, n: r.fail_list.length }, { error: 0, n: 0 });
});
test('확정: 이지어드민 콜백이 페이지를 옮겨도(예외) 결과는 먼저 돌려줌', async () => {
  const win = fakePage(w => serverReplies(w, null, { cbThrows: true })());
  win.jQuery.post = realPost('{"error":0,"fail_list":[]}');
  const r = await win.__mkwEzHelper.commit({ auto: true });
  assert.strictEqual(r.error, 0);
});
test('확정: 응답이 이미 객체(json)여도 성공으로 읽음', async () => {
  const win = fakePage(w => serverReplies(w, null, { dataType: 'json' })());
  win.jQuery.post = realPost({ error: 0, fail_list: ['1'] });
  const r = await win.__mkwEzHelper.commit({ auto: true });
  assert.deepStrictEqual({ error: r.error, n: r.fail_list.length }, { error: 0, n: 1 });
});
test('확정: 보낸 값이 문자열(serialize)이어도 가로챔', async () => {
  const win = fakePage(w => serverReplies(w, null, { stringData: true })());
  win.jQuery.post = realPost('{"error":0,"fail_list":[]}');
  const r = await win.__mkwEzHelper.commit({ auto: true });
  assert.strictEqual(r.error, 0);
});
test('확정: auto 가 아니면 거절', async () => {
  const win = fakePage(() => {});
  await assert.rejects(async () => win.__mkwEzHelper.commit({}), /자동 확정이 꺼져/);
});

/* ── 검색: 공급처·발주일을 넣고 검색을 누른 뒤, 이지어드민 로딩 표시가 사라지면 읽음 ── */
function searchPage(opts){
  opts = opts || {};
  const supply = { value: '0', options: [{ value: '0', text: '전체' }, { value: '20016', text: '곡물도감' }, { value: '20022', text: '잡곡 곡물도감' }]
                     .filter(o => !opts.noGok || o.value !== '20016') };
  const loader = { style: { display: 'none' } };
  const ex = { str_supply_code: supply, date_type: { value: 'order_date' }, load_grid1: loader,
               'input[name=start_date]': { value: '' }, 'input[name=end_date]': { value: '' },
               search: { click(){ loader.style.display = 'block'; if (!opts.stuck) setTimeout(() => { loader.style.display = 'none'; }, 60); } } };
  const win = fakePage(() => {}, ex);
  return { win, ex };
}
test('검색: 곡물도감·발주일을 넣고 검색이 끝나면 읽은 결과를 돌려줌', async () => {
  const { win, ex } = searchPage();
  const r = await win.__mkwEzHelper.search({ supplier: '곡물도감', date: '2026-10-27' });
  assert.strictEqual(ex.str_supply_code.value, '20016');
  assert.strictEqual(ex.date_type.value, 'collect_date');
  assert.strictEqual(ex['input[name=start_date]'].value, '2026-10-27');
  assert.strictEqual(ex['input[name=end_date]'].value, '2026-10-27');
  assert.strictEqual(r.rows.length, 0);   /* 다른 실행 공간의 배열이라 deepStrictEqual 대신 길이로 */
});
test('검색: 공급처 이름이 정확히 같은 것만 (잡곡 곡물도감 아님)', async () => {
  const { win } = searchPage({ noGok: true });
  await assert.rejects(async () => win.__mkwEzHelper.search({ supplier: '곡물도감', date: '2026-10-27' }), /공급처/);
});
test('검색: 로딩이 끝나지 않으면 시간 초과', async () => {
  const { win } = searchPage({ stuck: true });
  await assert.rejects(async () => win.__mkwEzHelper.search({ supplier: '곡물도감', date: '2026-10-27', ms: 400 }), /검색이 .*끝나지 않/);
});
test('검색: 시작일~끝일 기간으로 검색', async () => {
  const { win, ex } = searchPage();
  await win.__mkwEzHelper.search({ supplier: '곡물도감', from: '2026-10-20', to: '2026-10-27' });
  assert.strictEqual(ex['input[name=start_date]'].value, '2026-10-20');
  assert.strictEqual(ex['input[name=end_date]'].value, '2026-10-27');
});
test('검색: 시작일이 끝일보다 늦으면 거절', async () => {
  const { win } = searchPage();
  await assert.rejects(async () => win.__mkwEzHelper.search({ supplier: '곡물도감', from: '2026-10-28', to: '2026-10-27' }), /시작일/);
});

/* ── 자동합포금지 + 페이지 버튼으로 확정 (대표님 2026-10-27) ── */
function lockPage(){
  const lock = { type: 'checkbox', checked: false };
  let sent = null;
  const win = fakePage(w => {
    if (!w.confirm('일괄합포제외 하시겠습니까?')) return;
    const data = { template: 'DG00', action: 'drop_pack_all', info_all: 'x', auto_lock_unpack: lock.checked ? 1 : 0 };
    sent = data;
    w.jQuery.post('function.htm', data, function(){});
  }, { auto_lock_unpack: lock });
  win.jQuery.post = realPost('{"error":0,"fail_list":[]}');
  return { win, lock, sent: () => sent };
}
test('확정: 페이지 버튼(confirm:true)으로도 실행되고, 자동합포금지를 켜서 보냄', async () => {
  const { win, lock, sent } = lockPage();
  const r = await win.__mkwEzHelper.commit({ confirm: true, lockUnpack: true });
  assert.strictEqual(lock.checked, true);
  assert.strictEqual(sent().auto_lock_unpack, 1);
  assert.strictEqual(r.lock, 1);
  assert.strictEqual(r.error, 0);
});
test('확정: 자동합포금지 칸이 없으면 실행하지 않음', async () => {
  const win = fakePage(() => { throw new Error('눌리면 안 됨'); });
  await assert.rejects(async () => win.__mkwEzHelper.commit({ confirm: true, lockUnpack: true }), /자동합포금지/);
});

/* 송장출력 안전장치 */
test('출력 확인창은 정확히 그 문구만 통과 — 재출력 경고가 붙으면 거절', () => {
  const H = fakePage(() => {}).__mkwEzHelper;
  assert.strictEqual(H.printAsk('송장을 출력하시겠습니까?'), true);
  assert.strictEqual(H.printAsk('[주의]송장상태의 주문은 동일 송장 번호로 재출력됩니다.\n기존 송장은 반드시 파기하시기 바랍니다.\n\n송장을 출력하시겠습니까?'), false);
  assert.strictEqual(H.printAsk(''), false);
});
test('접수가 아니거나 송장번호가 있거나 0건이면 출력 금지', () => {
  const H = fakePage(() => {}).__mkwEzHelper;
  assert.deepStrictEqual(Array.from(H.printRowProblems([{ status: '접수', no: '' }])), []);
  assert.strictEqual(H.printRowProblems([]).length, 1);
  assert.strictEqual(H.printRowProblems([{ status: '송장', no: '' }]).length, 1);
  assert.strictEqual(H.printRowProblems([{ status: '접수', no: '123' }]).length, 1);
});
test('준비 없이는 printGo 가 누르지 않음', () => {
  const H = fakePage(() => {}).__mkwEzHelper;
  assert.throws(() => H.printGo({ confirm: true, token: 'x', count: 1 }), /준비가 끝나지/);
  assert.throws(() => H.printGo({ token: 'x' }), /준비가 끝나지/);
});
