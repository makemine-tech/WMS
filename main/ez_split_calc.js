/* ============================================================
   곡물도감 합포 분할 — 계산 (ez_split.html 짝꿍, 브라우저·Node 공용, 2026-10-27)
   설계서: docs/superpowers/specs/2026-10-27-ez-split-design.md

   입력 = 이지어드민 일괄합포제외(DG00) 표의 줄 (ez_helper.js read)
     { recv, seq, pack_seq, product_seq, product_id, name, options, qty, divided }
   주문 = 같은 pack_seq(합포 묶음)의 줄들. 송장 = { lines: [{ seq, prd, qty }] } (seq = product_seq)
   상품명에서 ★만 빼면 피킹이지 송장 PDF 상품명과 같아서, 피킹이지 박스 기록(boxKeyOf)을 그대로 찾을 수 있다.
============================================================ */
(function(){
  'use strict';

  /* ── 이름·구분 ── */
  function normName(name){ return String(name == null ? '' : name).replace(/★/g, '').trim(); }

  var KAN = { 15: 1, 30: 2, 45: 3, 60: 4 };
  function classify(prd){
    var m = prd.match(/(15|30|45|60)입/);
    if (m) return { kind: 'main', kan: KAN[m[1]], seori60: /^서리태 가득콩물 60입/.test(prd) };
    if (/^Granola|^C 그래놀라|^S |^N1 /.test(prd)) return { kind: 'small', kan: 0, seori60: false };
    if (/당쉼|^1병_|OTG|셀시어스/.test(prd)) return { kind: 'ori', kan: 0, seori60: false };
    return { kind: 'unknown', kan: 0, seori60: false };
  }

  /* picking_ez.html prodKeyOf + boxKeyOf 와 같은 키 (로케이션은 항상 '—') */
  function boxKeyOf(items){
    var s = items.map(function(it){ return '—|' + (it.prd || '—') + '|' + (it.qty || 1); }).sort().join(';;'), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'b' + h.toString(36) + s.length.toString(36);
  }

  /* ── 주문 묶기 ── flags: divided(이지어드민에서 이미 나뉨) · ori(오리진케어 섞임) · unknown(모르는 상품) · option(옵션 있음) */
  function buildOrders(rows){
    var map = {}, list = [];
    rows.forEach(function(r){
      var qty = Number(r.qty) || 0, o = map[r.pack_seq];
      if (!o){ o = map[r.pack_seq] = { pack: String(r.pack_seq), recv: r.recv || '', lines: [], flags: [] }; list.push(o); }
      var flag = function(f){ if (o.flags.indexOf(f) < 0) o.flags.push(f); };
      if (r.divided) flag('divided');
      if (!qty) return;
      var prd = normName(r.name), cls = classify(prd);
      if (cls.kind === 'ori') flag('ori');
      if (cls.kind === 'unknown') flag('unknown');
      if (String(r.options || '').trim()) flag('option');
      o.lines.push({ seq: String(r.product_seq), pid: String(r.product_id), prd: prd, qty: qty, cls: cls });
    });
    return list;
  }
  function canSplit(order){ return !order.flags.length && order.lines.length > 0; }

  var api = { normName: normName, classify: classify, boxKeyOf: boxKeyOf, buildOrders: buildOrders, canSplit: canSplit };
  if (typeof window !== 'undefined') window.EZ_SPLIT = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
