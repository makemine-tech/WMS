/* ============================================================
   메이크창고 전담비서 — 이지어드민 비서 읽기 전용 미리 보기 (브라우저·Node 공용, 2026-11-01)

   곡물도감 주문 줄을 「기존대로」(대표님 결정 2026-11-01)로 계산해 건수만 낸다.
   이지어드민을 채우거나 저장하지 않고, 수령자 이름·주소는 결과에 담지 않는다.
   blockers: 승인 단계라면 멈춰야 할 이유. 처음 보는 구성은 추측하지 않고 알린다.
============================================================ */
(function(root){
  'use strict';
  var MAX_ORDERS = 3500;   /* 임시값, 설계서 9장 */
  var SETTINGS = { ship: { 15: 0, 30: 0, 45: 0, 60: 0 }, sec: { single: 20, mix2: 60, mix3: 90 } };   /* 건수만 쓰므로 비용 값은 계산에 영향 없음 */
  var NEW_LIST = 20;

  function compOf(o){
    return o.lines.map(function(l){ return l.prd + '×' + l.qty; }).sort().join(' + ');
  }

  function preview(read, boxes, Z, fee){
    var rows = read.rows || [], orders = Z.buildOrders(rows), blockers = [];
    var ctx = { boxes: boxes || {}, fee: fee, settings: SETTINGS, times: {} };
    orders.forEach(function(o){ o.warn = []; });
    var plan = Z.planExisting(orders, ctx);
    var sm = Z.summary(plan.byPack, ctx.boxes);
    var flags = { divided: 0, unknown: 0, option: 0 }, comps = {}, unseen = 0, unk = {};
    orders.forEach(function(o){
      o.flags.forEach(function(f){ flags[f] = (flags[f] || 0) + 1; });
      o.lines.forEach(function(l){ if (l.cls.kind === 'unknown') unk[l.prd] = (unk[l.prd] || 0) + 1; });
      if (o.warn.indexOf('new') >= 0 || o.warn.indexOf('toomany') >= 0) {
        unseen++;
        var c = compOf(o);
        comps[c] = (comps[c] || 0) + 1;
      }
    });
    var newComps = Object.keys(comps).sort(function(a, b){ return comps[b] - comps[a]; }).slice(0, NEW_LIST)
      .map(function(c){ return { comp: c, orders: comps[c] }; });
    var unknownProds = Object.keys(unk).sort(function(a, b){ return unk[b] - unk[a]; }).slice(0, NEW_LIST)
      .map(function(n){ return { prd: n, orders: unk[n] }; });

    if (rows.length !== Number(read.total)) blockers.push('이지어드민에는 ' + read.total + '줄이 있는데 ' + rows.length + '줄만 읽혔습니다');
    if (flags.unknown) blockers.push('모르는 상품 ' + flags.unknown + '건');
    if (unseen) blockers.push('처음 보는 구성 ' + unseen + '건');
    if (orders.length > MAX_ORDERS) blockers.push('주문 ' + orders.length + '건으로 상한 ' + MAX_ORDERS.toLocaleString('en-US') + '건을 넘었습니다');

    return {
      rows: rows.length, orders: orders.length, invoices: sm.total, single: sm.single, multi: sm.multi,
      splitPacks: Z.fillPayload(orders, plan.byPack).length,
      sizes: Object.keys(sm.bySize).sort().map(function(s){ return { size: s, single: sm.bySize[s].single, multi: sm.bySize[s].multi }; }),
      flags: flags, newComps: newComps, unknownProds: unknownProds, unseen: unseen, blockers: blockers
    };
  }

  /* 도우미는 로딩 표시가 안 보이면 1.5초 뒤 표를 읽는다. 뒤에 깔린 탭에서는 결과가 늦게 뜰 수 있어,
     빈 결과면 기다렸다 한 번 더 읽고 나서 0건으로 믿는다 */
  var RECHECK_MS = 5000;
  function searchSettled(search, read, sleep){
    return search().then(function(r){
      if ((r.rows || []).length) return r;
      return sleep(RECHECK_MS).then(read);
    });
  }

  var API = { preview: preview, searchSettled: searchSettled, MAX_ORDERS: MAX_ORDERS, RECHECK_MS: RECHECK_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_EZ = API;
})(typeof window !== 'undefined' ? window : this);
