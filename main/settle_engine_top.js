/* ============================================================
   정산관리 — 탑프레쉬 (2026-10-04 대표님 · 2025-05 ~ 2026-08 정산서 16개월 분석)
     공통(settle_engine_std.js): 보관비(입출고 화물관리) · 배송비(이벗 택배비 리스트 출력양식 「탑프레쉬_택배발송」, 누락오배송 제외)
       택배크기 = 원본 값, 비어 있으면 극소 · 상품 10개 이상·미매칭·그린박스 계열 송장은 노란 표시 + 특이사항(크기 확인)
       제주 추가운임 400 → 항공/도서 · 택배발송 건수 = 택배크기 COUNTIF
     탑프레쉬 전용(아래 after):
       · 추가작업비정산 = 이벗 전체주문목록의 고객사 탑프레쉬 주문 전부, 옆 표 = 매칭상품명별 매칭수량 합계 (거래명세표 Y~Z 에도)
       · 그린박스띠지포장작업(300) = [TF-18]·[TF-19]·[TF-30]·4P세트 매칭수량 (대표님 B안 — 2025-10~2026-03 방식)
         그린박스세트포장작업(600) = [TF-30] · 뚜껑교체(300) = [TF-37] · 파손에어캡추가(300) = [JB000] · 선물세트작업(1000) = 알뜰세트 선물상자
         그 밖의 그린박스(TF-16·17·20·101·102)가 나오면 특이사항
       · 반품 = 박스앤캔 반품 시트의 탑프레쉬 줄 → 반품비 극소·소 = 박스크기별 건수
       · 솔루션 매달 그대로 · 퀵발송·쿠팡납품은 있을 때 직접
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var R = function(t){ return { d: '2026-10-04', t: t }; };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }
  /* 거래명세표 작업비 줄 = 매칭상품명 고르기 */
  var WORK = [
    { line: /그린박스띠지포장/, pick: /\[TF-(18|19|30)\]|4P세트/ },
    { line: /그린박스세트포장/, pick: /\[TF-30\]/ },
    { line: /뚜껑교체/, pick: /\[TF-37\]/ },
    { line: /파손에어캡/, pick: /\[JB000\]|파손주의에어캡/ },
    { line: /선물세트작업/, pick: /알뜰세트선물상자/ }
  ];
  var OTHER_GB = /\[TF-(16|17|20|101|102)\]/;   /* 기준에 없는 그린박스 — 나오면 특이사항 */

  function after(wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {};
    var ids = function(t){ return Object.keys(box).filter(function(id){ return box[id].type === t; }); };
    var read = function(L){ return L.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push(x); return acc; }); }); }, Promise.resolve([])); };
    var lineRow = function(re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(ns(row.getCell(2).value) + ns(row.getCell(6).value))) hit = r; }); return hit; };
    /* 1) 추가작업비정산 + 매칭상품명별 합계 */
    return read(ids('ebut_orders')).then(function(F){
      var ws = wb.getWorksheet('추가작업비정산'); if (!ws){ log.push(['확인 필요', '표본에 「추가작업비정산」 시트가 없음']); return; }
      var TH = []; ws.getRow(1).eachCell({ includeEmpty: true }, function(c, n){ TH[n - 1] = txt(c.value); });
      var nData = TH.indexOf('매칭수량') + 1 || TH.length;   /* 데이터 열 = 처음 ~ 매칭수량 (그 뒤는 옆 표) */
      var head = null, rows = [], seen = {};
      F.forEach(function(x){ var a = XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
        var H = a[0].map(ns), iC = H.indexOf('고객사'), iK = H.indexOf('NO');   /* 줄 번호 — 한 주문(코드)에 상품 여러 줄 */ if (iC < 0) return; head = head || a[0].map(String);
        a.slice(1).forEach(function(r){ if (!/탑프레쉬/.test(String(r[iC]))) return; var k = iK >= 0 ? String(r[iK]) : r.join('\u0001'); if (seen[k]) return; seen[k] = 1; rows.push({ H: H, r: r }); }); });
      if (!rows.length){ log.push(['확인 필요', '이벗 전체주문목록에 탑프레쉬 주문이 없음 — 작업비(그린박스 등) 0']); }
      var data = rows.map(function(o){ return TH.slice(0, nData).map(function(h){ var i = o.H.indexOf(ns(h)); return i >= 0 ? o.r[i] : ''; }); });
      /* 시트: 지난달 줄 지우고 새로 (옆 표 포함 전부) */
      var last = ws.rowCount, sty = []; for (var c0 = 1; c0 <= TH.length; c0++) sty[c0] = ws.getRow(2).getCell(c0).style;
      for (var r = 2; r <= last; r++) ws.getRow(r).eachCell({ includeEmpty: false }, function(c){ c.value = null; });
      data.forEach(function(v, i){ var row = ws.getRow(2 + i); v.forEach(function(x, j){ if (x === '' || x == null) return; var c = row.getCell(j + 1); c.value = x; if (sty[j + 1]) c.style = sty[j + 1]; }); });
      /* 매칭상품명별 합계 (완료 주문) */
      var iS = TH.indexOf('상태'), iP = TH.indexOf('매칭상품명'), iQ = TH.indexOf('매칭수량'), sum = {}, order = [];
      data.forEach(function(v){ if (iS >= 0 && String(v[iS]) !== '완료') return; var p = String(v[iP] || '').trim() || '(비어 있음)'; if (sum[p] == null){ sum[p] = 0; order.push(p); } sum[p] += +v[iQ] || 0; });
      var tot = order.reduce(function(s, p){ return s + sum[p]; }, 0);
      var pc = nData + 3;   /* 옆 표 열 (매칭수량 다음 두 칸 띄고) — 8월: AO·AP */
      ws.getRow(1).getCell(pc).value = '행 레이블'; ws.getRow(1).getCell(pc + 1).value = '합계 : 매칭수량';
      order.forEach(function(p, i){ ws.getRow(2 + i).getCell(pc).value = p; ws.getRow(2 + i).getCell(pc + 1).value = sum[p]; });
      ws.getRow(2 + order.length).getCell(pc).value = '총합계'; ws.getRow(2 + order.length).getCell(pc + 1).value = tot;
      /* 거래명세표 옆 표: 지난달 택배크기 피벗(S~W) · 매칭상품명 피벗(Y~Z) 지우고 Y~Z 새로 */
      for (var r2 = 15; r2 <= Math.max(st.rowCount, 90); r2++) for (var c2 = 19; c2 <= 26; c2++){ var cc = st.getRow(r2).getCell(c2); if (cc.value != null) cc.value = null; }
      st.getRow(18).getCell(25).value = '행 레이블'; st.getRow(18).getCell(26).value = '합계 : 매칭수량';
      var at = {}; order.forEach(function(p, i){ st.getRow(19 + i).getCell(25).value = p; st.getRow(19 + i).getCell(26).value = sum[p]; at[p] = 19 + i; });
      st.getRow(19 + order.length).getCell(25).value = '총합계'; st.getRow(19 + order.length).getCell(26).value = tot;
      /* 작업비 줄 = 고른 매칭상품명 합 (옆 표 칸을 더하는 수식) */
      var done = [];
      WORK.forEach(function(w){ var lr = lineRow(w.line); if (!lr) return;
        var ps = order.filter(function(p){ return w.pick.test(p.replace(/\s+/g, '')); }), v = ps.reduce(function(s, p){ return s + sum[p]; }, 0);
        st.getRow(lr).getCell(7).value = ps.length ? { formula: ps.map(function(p){ return 'Z' + at[p]; }).join('+'), result: v } : 0;
        done.push(ns(st.getRow(lr).getCell(2).value) + ' ' + v); });
      var other = order.filter(function(p){ return OTHER_GB.test(p.replace(/\s+/g, '')); });
      log.push(['자동 적용', '추가작업비정산 ← 주문목록 탑프레쉬 ' + data.length + '줄 · 매칭상품 ' + order.length + '종 합계 ' + tot + ' · ' + done.join(' · ')]);
      if (other.length) log.push(['특이사항', '기준에 없는 그린박스 제품 — 띠지·세트포장에 넣을지 확인: ' + other.map(function(p){ return p.replace(/\(.*$/, '') + ' ' + sum[p]; }).join(', ')]);
      if (sum['미매칭주문']) log.push(['특이사항', '미매칭 주문 ' + sum['미매칭주문'] + ' — 추가작업비정산 확인']);
    }).then(function(){
      /* 2) 반품 = 박스앤캔 반품 시트 탑프레쉬 */
      var ws = wb.getWorksheet('반품'), r1 = lineRow(/^반품비/), r2 = r1 ? r1 + 1 : 0; if (!ws) return;
      var L = ids('bnc_courier');
      if (!L.length){ [r1, r2].forEach(function(r){ if (r){ var g = st.getRow(r).getCell(7); g.value = 0; g.style = Object.assign({}, g.style, { fill: YEL }); } });
        log.push(['확인 필요', '박스앤캔 택배비 파일이 아직 없어 반품비 0 (노란 칸) — 들어오면 초안 다시 받기']); return; }
      return read(L).then(function(F){
        var TH = []; ws.getRow(1).eachCell(function(c, n){ TH[n - 1] = txt(c.value); }); TH = Array.prototype.slice.call(TH).map(function(h){ return h || ''; });
        var rows = [];
        F.forEach(function(x){ var w = x.Sheets['반품']; if (!w) return; var a = XLSX.utils.sheet_to_json(w, { header: 1, defval: '' }); var H = (a[0] || []).map(ns), iC = H.indexOf('고객명');
          a.slice(1).forEach(function(r){ if (/탑프레쉬/.test(String(r[iC]))) rows.push(TH.map(function(h){ var i = H.indexOf(ns(h)); return i >= 0 ? r[i] : ''; })); }); });
        replaceSheet(wb, '반품', TH, rows);
        var iZ = TH.indexOf('박스크기'), n = { 극소: 0, 소: 0 }, odd = 0; rows.forEach(function(r){ var z = String(r[iZ]).trim(); if (n[z] != null) n[z]++; else odd++; });
        var Lz = String.fromCharCode(65 + iZ), last = Math.max(2, rows.length + 1);
        if (r1) st.getRow(r1).getCell(7).value = { formula: 'COUNTIF(반품!' + Lz + '2:' + Lz + last + ',"극소")', result: n.극소 };
        if (r2 && /^소$/.test(ns(st.getRow(r2).getCell(6).value))) st.getRow(r2).getCell(7).value = { formula: 'COUNTIF(반품!' + Lz + '2:' + Lz + last + ',"소")', result: n.소 };
        log.push(['자동 적용', '반품 ← 박스앤캔 반품 시트 탑프레쉬 ' + rows.length + '건 · 극소 ' + n.극소 + ' · 소 ' + n.소]);
        if (odd) log.push(['특이사항', '반품 박스크기가 극소·소가 아닌 줄 ' + odd + '건 — 반품비 확인']);
      });
    }).then(function(){
      log.push(['안내', '서초 본사 퀵·쿠팡납품은 있을 때 직접 입력 (6·7월 퀵 40,000 · 8월 없음)']);
    });
  }

  E['탑프레쉬_당월분'] = window.SETTLE_STD({ name: '탑프레쉬', shipSheet: '배송비', needs: ['ebut_shiplist', 'ebut_orders', 'bnc_courier'],
    sheets: { '배송비': 'skip', '보관비': 'skip' }, ownSheets: /^(추가작업비정산|반품|쿠팡입고내역)$/,
    sizeDefault: '극소', bigQty: 10, bigRe: /그린박스|\[TF-(1[6-9]|20|30|101|102)\]/, bigName: '그린박스',
    items: { 17: 'auto', 18: 'auto', 19: 'auto', 20: 'auto', 21: 'auto', 23: 'auto', 24: 'auto', 27: 'auto', 33: 'auto', 34: 'auto', 35: 'auto', 36: 'auto', 37: 'auto', 14: 'fixed' },
    /* ✅ 7월 확정본 + 8월 원본으로 8월 재현: 항공/도서 2 · 반품 2 · 보관비 1,550 일치 (2026-10-04) */
    verified: { 21: true, 23: true, 27: true },
    after: after,
    ruleList: [R('배송비 = 이벗 택배비 리스트 출력양식 「탑프레쉬_택배발송」(누락오배송 제외) · 택배크기 원본 값, 비어 있으면 극소 · 상품 10개 이상·미매칭·그린박스 송장은 노란 표시 → 크기 확인'),
      R('추가작업비정산 = 주문목록 고객사 탑프레쉬 주문, 옆 표 = 매칭상품명별 매칭수량 합계'),
      R('그린박스띠지포장 = [TF-18]·[TF-19]·[TF-30]·4P세트 · 세트포장 = [TF-30] · 뚜껑교체 = [TF-37] · 파손에어캡 = [JB000] · 선물세트 = 알뜰세트 선물상자 (B안)'),
      R('반품비 = 박스앤캔 반품 시트 탑프레쉬 줄 박스크기별 건수 · 퀵발송·쿠팡납품은 있을 때 직접')].concat(window.SETTLE_STD_RULES || []) });
})();
