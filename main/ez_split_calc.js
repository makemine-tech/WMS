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

  /* ── 단위 ── 본품은 수량만큼 (완제 박스 1개 = 단위 1), 소형은 전부 한 덩어리 */
  function units(order){
    var u = [], small = null;
    order.lines.forEach(function(l){
      if (l.cls.kind === 'main'){ for (var i = 0; i < l.qty; i++) u.push({ seq: l.seq, prd: l.prd, kan: l.cls.kan, seori60: l.cls.seori60 }); }
      else { if (!small){ small = { small: true, lines: [] }; } small.lines.push({ seq: l.seq, prd: l.prd, qty: l.qty }); }
    });
    if (small) u.push(small);
    return u;
  }
  /* 단위 묶음 → 송장 (같은 상품 줄은 수량 합침) */
  function toInvoice(us){
    var lines = [], at = {};
    function add(seq, prd, qty){ if (at[seq] != null) lines[at[seq]].qty += qty; else { at[seq] = lines.length; lines.push({ seq: seq, prd: prd, qty: qty }); } }
    us.forEach(function(x){ if (x.small) x.lines.forEach(function(l){ add(l.seq, l.prd, l.qty); }); else add(x.seq, x.prd, 1); });
    return { lines: lines };
  }
  function kanOf(inv){
    var k = 0, small = false;
    inv.lines.forEach(function(l){ var c = classify(l.prd); if (c.kind === 'main') k += c.kan * l.qty; else small = true; });
    return k + (small ? 1 : 0);
  }
  function hasSeori60(inv){ return inv.lines.some(function(l){ return classify(l.prd).seori60; }); }

  /* 막대 왼쪽 끝 = 전부 분리: 본품 단위 하나 = 송장 하나, 소형은 칸이 가장 작은 송장에 (서리태60 송장에는 안 넣음) */
  function splitMax(order){
    var us = units(order), small = null, bins = [];
    us.forEach(function(x){ if (x.small) small = x; else bins.push([x]); });
    if (small){
      var best = -1;
      bins.forEach(function(b, i){ if (!b[0].seori60 && (best < 0 || b[0].kan < bins[best][0].kan)) best = i; });
      if (best < 0) bins.push([small]); else bins[best].push(small);
    }
    return bins.map(toInvoice);
  }
  /* 막대 오른쪽 끝 = 전부 합포: 4칸(60박스)까지, 칸 큰 것부터 first-fit. 소형은 1칸, 서리태60 상자에는 안 넣음 */
  function splitMin(order){
    var us = units(order), small = null, mains = [], bins = [];
    us.forEach(function(x){ if (x.small) small = x; else mains.push(x); });
    mains.map(function(x, i){ return { x: x, i: i }; })
      .sort(function(a, b){ return b.x.kan - a.x.kan || a.i - b.i; })
      .forEach(function(e){
        var b = null;
        for (var i = 0; i < bins.length && !b; i++) if (bins[i].kan + e.x.kan <= 4 && !bins[i].seori60) b = bins[i];
        if (!b){ b = { kan: 0, seori60: false, us: [] }; bins.push(b); }
        b.us.push(e.x); b.kan += e.x.kan; if (e.x.seori60) b.seori60 = true;
      });
    if (small){
      var sb = null;
      for (var j = 0; j < bins.length && !sb; j++) if (bins[j].kan + 1 <= 4 && !bins[j].seori60) sb = bins[j];
      if (sb) sb.us.push(small); else bins.push({ us: [small] });
    }
    return bins.map(function(b){ return toInvoice(b.us); });
  }
  /* 송장 박스 크기: 피킹이지 기록 → 없으면 규칙 (소형만 15, 그 외 칸×15) */
  function boxSize(inv, boxes){
    var rec = boxes && boxes[boxKeyOf(inv.lines)];
    if (rec) return String(rec);
    var main = inv.lines.some(function(l){ return classify(l.prd).kind === 'main'; });
    return main ? String(15 * kanOf(inv)) : '15';
  }

  var api = { normName: normName, classify: classify, boxKeyOf: boxKeyOf, buildOrders: buildOrders, canSplit: canSplit,
              units: units, toInvoice: toInvoice, kanOf: kanOf, hasSeori60: hasSeori60, splitMax: splitMax, splitMin: splitMin, boxSize: boxSize };
  if (typeof window !== 'undefined') window.EZ_SPLIT = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
