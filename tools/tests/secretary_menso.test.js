/* 맨소래담 사은품 미리 보기 (main/secretary_menso.js) */
const test = require('node:test');
const assert = require('node:assert');
const { preview, previewCampaign, giftStatus, flow } = require('../../main/secretary_menso.js');

const CAMP = { name: '아크네스', brand: '아크네스', site: '맨소레담공식스마트스토어', basis: 'reg', from: '2026-10-27', to: '2026-11-01', confirmed: true,
  tiers: [{ min: 15000, gifts: ['플루이드 20ml'] }, { min: 20000, gifts: ['플루이드 20ml', '포하'] }, { min: 30000, gifts: ['플루이드 20ml', '포하', '모공클리어'] }] };
function row(no, name, amt, extra) {
  return Object.assign({ no, name, qty: 1, amt, siteName: '맨소레담공식스마트스토어', fnsh: '0', regDate: '2026-10-30', orderDate: '2026-10-30T09:00:00' }, extra);
}
const run = (rows, gifts, c) => previewCampaign({ rows, gifts: gifts || {} }, c || CAMP);
const tier = (p, min) => p.tiers.find((t) => t.min === min);

test('대상 브랜드가 있으면 주문 전체 금액으로 가장 높은 구간 하나', () => {
  const p = run([row('A', '아크네스 폼', 10000), row('A', '다른 상품', 10000)]);
  assert.strictEqual(p.orders, 1);
  assert.strictEqual(tier(p, 20000).need, 1);
  assert.strictEqual(tier(p, 15000).need, 0);
  assert.strictEqual(p.need, 1);
  assert.deepStrictEqual(p.needList, [{ no: 'A', amt: 20000, min: 20000 }]);
});

test('경계값: 정확히 구간 금액이면 그 구간, 바로 아래는 아래 구간', () => {
  assert.strictEqual(tier(run([row('A', '아크네스', 15000)]), 15000).need, 1);
  assert.strictEqual(run([row('A', '아크네스', 14999)]).under, 1);
  assert.strictEqual(tier(run([row('A', '아크네스', 29999)]), 20000).need, 1);
  assert.strictEqual(tier(run([row('A', '아크네스', 30000)]), 30000).need, 1);
});

test('대상 브랜드가 없으면 금액이 커도 제외', () => {
  assert.strictEqual(run([row('A', '하다라보', 90000)]).orders, 0);
});

test('연동몰, 다른 판매처, 취소 주문은 제외', () => {
  assert.strictEqual(run([row('A', '아크네스', 90000, { siteName: '맨소래담_연동몰' })]).orders, 0);
  assert.strictEqual(run([row('A', '아크네스', 90000, { siteName: '체험단' })]).orders, 0);
  assert.strictEqual(run([row('A', '아크네스', 90000, { fnsh: '2' })]).orders, 0);
});

test('사은품 줄 금액은 합계와 대상 판단에서 뺌', () => {
  const p = run([row('A', '사은품', 99999), row('A', '아크네스', 15000)], { A: ['플루이드 20ml'] });
  assert.strictEqual(tier(p, 15000).done, 1);
  assert.strictEqual(p.need, 0);
});

test('날짜 기준: 등록일과 주문일, 범위 밖은 따로 셈', () => {
  const r = [row('A', '아크네스', 20000, { regDate: '2026-11-02', orderDate: '2026-11-01T23:00:00' })];
  assert.strictEqual(run(r).outside, 1);
  assert.strictEqual(run(r, {}, Object.assign({}, CAMP, { basis: 'order' })).orders, 1);
});

test('사은품 내용 대조: 맞음, 빠짐, 더 많음, 구간 미달인데 있음', () => {
  assert.strictEqual(giftStatus(CAMP.tiers[1], []), 'need');
  assert.strictEqual(giftStatus(CAMP.tiers[1], ['(사은품) 플루이드 20ml', '(사은품) 아크네스 포하 딥 클렌징 오일 30ml']), 'done');
  assert.strictEqual(giftStatus(CAMP.tiers[1], ['(사은품) 플루이드 20ml']), 'wrong');
  assert.strictEqual(giftStatus(CAMP.tiers[0], ['플루이드 20ml', '포하']), 'wrong');
  assert.strictEqual(giftStatus({ min: 1, gifts: [] }, ['아무거나']), 'done');
  const p = run([row('A', '아크네스', 30000), row('B', '아크네스', 1000)], { A: ['(사은품) 플루이드 20ml'], B: ['(사은품) 플루이드 20ml'] });
  assert.strictEqual(tier(p, 30000).wrong, 1);
  assert.strictEqual(p.wrong.length, 2);
  assert.match(p.wrong.map((w) => w.why).join(), /미달/);
});

test('대상 상품명을 보여 주어 엉뚱한 상품을 알아볼 수 있음', () => {
  const p = run([row('A', '아크네스 폼', 15000), row('B', '아크네스 폼', 15000), row('C', '비아크네스 유사품', 15000)]);
  assert.deepStrictEqual(p.names[0], { name: '아크네스 폼', rows: 2 });
  assert.strictEqual(p.names.length, 2);
});

test('preview: 확인 안 한 행사표는 계산 안 함, 멈출 이유를 모음', () => {
  const read = { rows: [row('A', '아크네스', 30000), row('B', '하다라보', 1000, { siteName: '맨소래담_새판매처' })], total: 3, gifts: { A: ['플루이드 20ml'] }, unmatched: ['B'] };
  const p = preview(read, [CAMP, Object.assign({}, CAMP, { name: '초안', confirmed: false })]);
  assert.strictEqual(p.campaigns.length, 1);
  assert.strictEqual(p.drafts, 1);
  assert.strictEqual(p.orders, 2);
  const b = p.blockers.join(' / ');
  assert.match(b, /3줄이 있는데 2줄/);
  assert.match(b, /새판매처/);
  assert.match(b, /매칭 안 된 줄 1건/);
  assert.match(b, /구간과 다른 사은품 1건/);
});

test('이미 나간 주문의 다른 사은품은 할 일이 아니라 수만 남김', () => {
  const r = [row('A', '아크네스', 30000, { fnsh: '1' }), row('B', '아크네스', 30000, { fnsh: '1' })];
  const p = run(r, { A: ['플루이드 20ml'] });
  assert.strictEqual(p.past, 2);
  assert.strictEqual(p.need, 0);
  assert.strictEqual(p.wrong.length, 0);
  assert.strictEqual(preview({ rows: r, total: 2, gifts: { A: ['플루이드 20ml'] } }, [CAMP]).blockers.length, 0);
});

const flowRow = (no, extra) => row(no, '아크네스', 15000, Object.assign({ ivDate: '2026-11-02', dno: '123' }, extra));
const states = (f) => Object.fromEntries(f.steps.map((s) => [s.id, s.state]));

test('흐름도: 주문이 없으면 전부 대기', () => {
  const s = states(flow({ rows: [] }, []));
  assert.strictEqual(s.collect, 'wait');
  assert.strictEqual(s.ship, 'wait');
  assert.strictEqual(s.bizem, 'later');
});

test('흐름도: 앞 단계가 막히면 거기만 빨강, 뒤는 회색', () => {
  const f = flow({ rows: [flowRow('A', { ivDate: '', dno: '' })], unmatched: ['A', 'A'] }, []);
  const s = states(f);
  assert.strictEqual(s.collect, 'done');
  assert.strictEqual(s.match, 'todo');
  assert.strictEqual(f.steps.find((x) => x.id === 'match').count, 2);
  assert.strictEqual(s.confirm, 'wait');
  assert.strictEqual(s.gift, 'wait');
});

test('흐름도: 단계가 끝날수록 파랑이 앞으로', () => {
  assert.strictEqual(states(flow({ rows: [flowRow('A', { ivDate: '', dno: '' })] }, [])).confirm, 'todo');
  let s = states(flow({ rows: [flowRow('A', { dno: '' })] }, [{ need: 2, wrong: [] }]));
  assert.strictEqual(s.confirm, 'done');
  assert.strictEqual(s.gift, 'todo');
  s = states(flow({ rows: [flowRow('A', { dno: '' })] }, [{ need: 0, wrong: [] }]));
  assert.strictEqual(s.gift, 'done');
  assert.strictEqual(s.invoice, 'todo');
  s = states(flow({ rows: [flowRow('A')] }, []));
  assert.strictEqual(s.invoice, 'done');
  assert.strictEqual(s.ship, 'todo');
});

test('흐름도: 모두 출고되면 출고처리까지 파랑, 취소·사은품 줄은 세지 않음', () => {
  const f = flow({ rows: [flowRow('A', { fnsh: '1' }), row('A', '사은품', 0, { fnsh: '1' }), flowRow('B', { fnsh: '2', ivDate: '', dno: '' })] }, []);
  assert.strictEqual(f.orders, 1);
  assert.strictEqual(f.waiting, 0);
  assert.strictEqual(states(f).ship, 'done');
});

test('결과에 수령자 정보 칸이 없음', () => {
  const p = preview({ rows: [row('A', '아크네스', 15000, { recv: '홍길동', addr: '서울' })], total: 1 }, [CAMP]);
  assert.strictEqual(JSON.stringify(p).includes('홍길동'), false);
  assert.strictEqual(JSON.stringify(p).includes('서울'), false);
});

test('흐름 순서: 주문수집 → 비젬 주문수집 → 비젬 주문가져오기 → 매칭 … 비젬 송장전송', () => {
  const ids = flow({ rows: [] }, []).steps.map((s) => s.id);
  assert.deepStrictEqual(ids, ['collect', 'bizem_collect', 'bizem_import', 'match', 'confirm', 'gift', 'invoice', 'ship', 'send', 'bizem']);
  const s = states(flow({ rows: [flowRow('A', { ivDate: '', dno: '' })] }, []));
  assert.strictEqual(s.bizem_collect, 'later');
  assert.strictEqual(s.bizem_import, 'later');
});

test('비젬 칸이 없이 저장된 예전 결과에도 제자리에 끼워 넣고, 두 번 넣지 않음', () => {
  const { withBizem } = require('../../main/secretary_menso.js');
  const old = [{ id: 'collect' }, { id: 'match' }];
  const a = withBizem(old);
  assert.deepStrictEqual(a.map((x) => x.id), ['collect', 'bizem_collect', 'bizem_import', 'match']);
  assert.strictEqual(withBizem(a).length, 4);
});

test('비젬 칸: 주문확정이 남으면 2번, 인쇄 대기만 남으면 3번, 못 읽었으면 점선', () => {
  const { bizemSteps } = require('../../main/secretary_menso.js');
  const st = (site) => Object.fromEntries(bizemSteps(flow({ rows: [] }, []).steps, site).map((s) => [s.id, [s.state, s.count]]));
  let s = st({ state: 'ok', counts: { unconfirmed: 5, printWait: 3 } });
  assert.deepStrictEqual(s.bizem_collect, ['todo', 5]);
  assert.deepStrictEqual(s.bizem_import, ['wait', 0]);
  s = st({ state: 'ok', counts: { unconfirmed: 0, printWait: 3 } });
  assert.deepStrictEqual(s.bizem_collect, ['wait', 0]);
  assert.deepStrictEqual(s.bizem_import, ['todo', 3]);
  s = st({ state: 'ok', counts: { unconfirmed: 0, printWait: 0 } });
  assert.strictEqual(s.bizem_collect[0], 'wait');
  assert.strictEqual(s.bizem_import[0], 'wait');
  for (const site of [undefined, { state: 'login' }, { state: 'ok' }]) {
    s = st(site);
    assert.strictEqual(s.bizem_collect[0], 'later');
    assert.strictEqual(s.bizem_import[0], 'later');
  }
});
