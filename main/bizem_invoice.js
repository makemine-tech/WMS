/* ============================================================
   비젬 송장업로드 — 파일 고르기와 진행 판단 (secretary.html 짝꿍, 브라우저·Node 공용, 2026-11-06)

   이벗에서 받은 송장 파일에서 세 열만 남긴다 (대표님 2026-11-06):
     A 쇼핑몰주문번호 · J 우편번호 · W 운송장번호
   받는 사람 이름·주소·전화는 이 기기 밖으로 나가지 않는다. 남긴 세 열도 상시 컴퓨터 공개키로 잠가서만 보낸다.
   비젬 업로드 화면 설정: 우체국택배 · 쇼핑몰주문번호 A열 · 운송장번호 W열 · 우편번호 J열 (열 위치를 그대로 둔다)
============================================================ */
(function(root){
  'use strict';
  var COL = { order: 0, post: 9, waybill: 22 }, WIDTH = 23;
  var WAYBILL = /^\d{10,14}$/;
  var BATCH = 100;          /* 비젬 한 화면 단위. 발송검수·전송을 이만큼씩 */

  function cell(v){ return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function post(v){ var p = cell(v).replace(/[^\d]/g, ''); return p.length === 4 ? '0' + p : p; }   /* 숫자로 읽힌 우편번호는 앞 0 이 빠짐 */

  /* rows = 엑셀 첫 시트를 줄 배열로(sheet_to_json header:1, raw:false). 첫 줄이 제목이면 제목으로 둠 */
  function pick(rows){
    var out = { head: null, lines: [], orders: [], bad: [], empty: 0, dup: 0 }, seen = {};
    (rows || []).forEach(function(r, i){
      r = r || [];
      var o = cell(r[COL.order]), w = cell(r[COL.waybill]).replace(/[-\s]/g, '');
      if (i === 0 && !WAYBILL.test(w)) { out.head = r; return; }
      if (!o && !w) { out.empty++; return; }
      if (!o || /e\+/i.test(o) || !WAYBILL.test(w)) { out.bad.push(i + 1); return; }   /* 몇 번째 줄인지(1부터) */
      out.lines.push([o, post(r[COL.post]), w]);
      if (seen[o]) out.dup++; else { seen[o] = true; out.orders.push(o); }
    });
    return out;
  }
  function row(o, p, w){ var r = []; for (var i = 0; i < WIDTH; i++) r.push(''); r[COL.order] = o; r[COL.post] = p; r[COL.waybill] = w; return r; }
  /* 비젬에 올릴 줄: 세 열만 원래 자리에 둠 */
  function sheetRows(p){
    var h = p.head || [];
    var head = row(cell(h[COL.order]) || '쇼핑몰주문번호', cell(h[COL.post]) || '우편번호', cell(h[COL.waybill]) || '운송장번호');
    return [head].concat(p.lines.map(function(l){ return row(l[0], l[1], l[2]); }));
  }
  function fileName(day){ return '송장업로드_' + day + '.xlsx'; }

  /* 비젬 목록 줄({ o: 쇼핑몰주문번호, b: 비젬주문번호, s: 배송상태 })을 우리 주문만 남겨 상태별로 셈. 묶음이면 한 비젬주문번호에 여러 줄 */
  function tally(list, orders){
    var want = {}, byOrder = {}, out = { C10: 0, D10: 0, E10: 0, E11: 0, other: 0, missing: 0, bzm: { C10: [], D10: [] } }, seenB = {};
    (orders || []).forEach(function(o){ want[o] = true; });
    (list || []).forEach(function(r){
      if (!r || !want[r.o]) return;
      byOrder[r.o] = r.s;
      if ((r.s === 'C10' || r.s === 'D10') && !seenB[r.b]) { seenB[r.b] = true; out.bzm[r.s].push(r.b); }
    });
    (orders || []).forEach(function(o){
      var s = byOrder[o];
      if (!s) out.missing++;
      else if (s === 'C10' || s === 'D10' || s === 'E10' || s === 'E11') out[s]++;
      else out.other++;
    });
    return out;
  }
  function batches(list){ var out = []; for (var i = 0; i < list.length; i += BATCH) out.push(list.slice(i, i + BATCH)); return out; }

  var api = { COL: COL, BATCH: BATCH, pick: pick, sheetRows: sheetRows, fileName: fileName, tally: tally, batches: batches };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BIZEM_INVOICE = api;
})(typeof self !== 'undefined' ? self : this);
