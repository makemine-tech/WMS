/* 이지어드민 도우미 (main/ez_helper.js) — 확정(commit) 경로를 가짜 이지어드민 화면에서 시험
   진짜 「일괄합포제외」를 누르지 않고, 이지어드민이 $.post 를 부르는 여러 모양을 흉내 낸다 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../../main/ez_helper.js', 'utf8');

/* post(url, data, cb, dataType) 를 받아 이지어드민 버튼이 하는 일을 흉내 내는 가짜 화면 */
function fakePage(onClick){
  const el = () => ({ style: {}, set innerHTML(v){}, remove(){}, appendChild(){}, querySelector(){ return null; } });
  const btn = { click(){ onClick(win); } };
  const doc = { body: el(), head: el(), createElement: el, getElementById: id => id === 'divide_pack_all' ? btn : id === 'grid1' ? el() : null,
                querySelectorAll: () => [] };
  const jq = function(){ return { getGridParam(){ return 0; } }; };
  jq.post = function(){ throw new Error('원래 $.post 가 바뀌지 않음'); };
  const win = { location: { hostname: 'ga89.ezadmin.co.kr', search: '?template=DG00' }, document: doc, jQuery: jq, $: jq,
                alert(){}, confirm(){ return false; }, open(){ return null; }, opener: null,
                addEventListener(){}, removeEventListener(){}, setTimeout, clearTimeout, Promise, JSON };
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
