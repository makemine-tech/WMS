/* ============================================================
   정산관리 — 앳댓모먼트 (2026-10-04 대표님 룰)
     1. 배송비 시트 = 이벗 쉽먼트 택배리스트에서 앳댓모먼트 줄 + 이벗 전체주문목록의 앳댓모먼트 주문 중 송장번호가 쉽먼트 리스트에 없는 것만 (송장번호 하나 = 한 줄)
     2. 택배크기 = 원본 값, 없으면 극소
     3. 추가운임 = 주문목록에서 송장번호의 주소가 제주면 400 (공통 shipSheetFinish)
     4. 쿠팡입고내역 = 앳댓모먼트 쿠팡 발주서(MMDD_앳댓모먼트.xls, 파일 이름 = 입고일) 전부 합쳐 A~확정수량, 입고예정일이 이번 달인 줄만
        옆 표(N~P) = 입고예정일·물류센터별 건수(줄 수) + 총합계 → 거래명세표 쿠팡납품 출고건수
     5. 타택배반품 = 있을 때 직접 기입 (시트는 비워 둠)
     6. 거래명세표: 쿠팡납품 출고건수 · 택배발송 건수 · 기본작업비(택배 합계 수식) · 솔루션·보관비는 매달 그대로
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var R = function(t){ return { d: '2026-10-04', t: t }; };
  var AT = /앳댓/;
  function ns(v){ if (v && v.richText) v = v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) v = v.result; return String(v == null ? '' : v).replace(/\s+/g, ''); }
  function ymd(v){ if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); var s = String(v || '').trim(), m = s.match(/^(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})/); return m ? m[1] + '-' + m[2] + '-' + m[3] : s; }

  E['앳댓모먼트'] = { needs: ['ebut_orders', 'ebut_shiplist', 'coupang_po'],
    /* 8 쿠팡납품 출고건수 · 17~20 택배발송 · 21 제주도 · 24 기본작업비(택배 합계) = 이 엔진 · 14 솔루션 · 26 보관비 = 매달 그대로
       ✅ 7월 확정본 + 8월 원본으로 8월 확정본 재현: 출고건수 16 · 극소 14 · 기본작업비 14 · 쿠팡입고내역 16줄·날짜센터 표 · 배송비 송장 14건 일치 (2026-10-04) */
    items: { 8: 'auto', 17: 'auto', 18: 'auto', 19: 'auto', 20: 'auto', 21: 'auto', 24: 'auto', 14: 'fixed', 26: 'fixed' }, sheets: {}, verified: { 8: true, 17: true, 24: true }, opt: {},
    ownSheets: /^(배송비|쿠팡입고내역|타택배반품)$/, verifiedSheets: /^(배송비|쿠팡입고내역)$/,
    ruleList: [R('배송비 = 이벗 쉽먼트 택배리스트의 앳댓모먼트 줄 + 전체주문목록의 앳댓모먼트 주문 중 송장번호가 쉽먼트 리스트에 없는 것(송장번호 하나 = 한 줄)'),
      R('택배크기 = 원본 값, 없으면 극소'), R('추가운임 = 주문목록 주소가 제주인 송장 400'),
      R('쿠팡입고내역 = 앳댓모먼트 쿠팡 발주서 전부 합쳐 A~확정수량(입고예정일이 이번 달인 줄), 옆 표 = 입고예정일·물류센터별 건수 → 거래명세표 쿠팡납품 출고건수'),
      R('타택배반품 = 있을 때 직접 기입'), R('솔루션·보관비 = 매달 그대로, 기본작업비 = 택배발송 합계')],
    afterBuild: function(wb, ctx){
      var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, YM = ctx.YM;
      var ids = function(t, re){ return Object.keys(box).filter(function(id){ return box[id].type === t && (!re || re.test(box[id].name)); }); };
      var read = function(L){ return L.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push({ name: box[id].name, wb: x }); return acc; }); }); }, Promise.resolve([])); };
      var aoa = function(x, need){ var out = []; x.SheetNames.forEach(function(n){ var a = XLSX.utils.sheet_to_json(x.Sheets[n], { header: 1, defval: '' });
        for (var i = 0; i < Math.min(a.length, 12); i++){ var h = a[i].map(ns); if (need.every(function(k){ return h.indexOf(k) >= 0; })){ out.push({ H: h, rows: a.slice(i + 1).filter(function(r){ return r.some(function(v){ return v !== ''; }); }) }); break; } } }); return out; };
      var ship = [], ord = [];
      /* 1) 쉽먼트 택배리스트(택배비 리스트 모양)와 주문목록 — 주문목록 모양으로 받은 쉽먼트 리스트도 주문목록으로 */
      return read(ids('ebut_shiplist')).then(function(F){
        F.forEach(function(f){ aoa(f.wb, ['송장번호', '택배크기']).forEach(function(T){ T.rows.forEach(function(r){ if (AT.test(r.join('|'))) ship.push({ H: T.H, r: r }); }); }); });
        return read(ids('ebut_orders'));
      }).then(function(F){
        F.forEach(function(f){ aoa(f.wb, ['송장번호', '판매처', '주소']).forEach(function(T){ T.rows.forEach(function(r){ if (AT.test(r.join('|'))) ord.push({ H: T.H, r: r }); }); }); });
        var ws = wb.getWorksheet('배송비'); if (!ws){ log.push(['확인 필요', '표본에 「배송비」 시트가 없음']); return; }
        var TH = []; ws.getRow(1).eachCell(function(c, n){ TH[n - 1] = ns(c.value); }); TH = Array.prototype.slice.call(TH).map(function(h){ return h || ''; });
        var rows = [], seen = {}, fromShip = 0, fromOrd = 0;
        ship.forEach(function(s){ var g = function(k){ var i = s.H.indexOf(k); return i >= 0 ? s.r[i] : ''; }, inv = ns(g('송장번호')); if (!inv || seen[inv]) return; seen[inv] = 1; fromShip++;
          rows.push(TH.map(function(h){ return h === '건수' ? 1 : h === '택배크기' ? (ns(g('택배크기')) || '극소') : g(h); })); });
        /* 주문목록: 송장번호별로 묶어 한 줄 (쉽먼트 리스트에 없는 송장만) */
        var byInv = {}, order = [];
        ord.forEach(function(o){ var g = function(k){ var i = o.H.indexOf(k); return i >= 0 ? o.r[i] : ''; }, inv = ns(g('송장번호')); if (!inv || seen[inv]) return; if (/취소|삭제/.test(ns(g('상태')))) return;
          /* 같은 주문(코드)이 여러 파일에 있으면 한 번만 — 매칭 정보가 있는 쪽 */
          if (!byInv[inv]){ byInv[inv] = {}; order.push(inv); } var oc = ns(g('코드')) || ns(g('NO')) + '|' + ns(g('상품명')), had = byInv[inv][oc];
          if (!had || (!ns(had('매칭관리명') || had('매칭상품명')) && ns(g('매칭관리명') || g('매칭상품명')))) byInv[inv][oc] = g; });
        order.forEach(function(inv){ var L = Object.keys(byInv[inv]).map(function(k){ return byInv[inv][k]; }), g = L[0], d = ymd(g('등록일')).replace(/-/g, ''), d2 = ymd(g('출고일') || g('등록일')).replace(/-/g, ''), seller = String(g('판매처') || '');
          var q = L.reduce(function(s, x){ return s + (+x('수량') || 0); }, 0), mq = L.reduce(function(s, x){ return s + (+x('매칭수량') || +x('수량') || 0); }, 0);
          var val = { 등록일: d, 출고일: d2, 판매처명: seller, 수령자: g('수령자'), 주문정보: L.map(function(x){ return x('상품명') + '-' + x('옵션') + '-' + x('수량'); }).join('<br>'),
            수량: q, 매칭정보: L.filter(function(x){ return ns(x('매칭관리명') || x('매칭상품명')); }).map(function(x){ return (x('매칭관리명') || x('매칭상품명')) + '-' + x('매칭옵션명') + '-' + (x('매칭수량') || x('수량')); }).join('$'), 매칭총수량: mq,
            상품종류: Object.keys(L.reduce(function(o, x){ o[ns(x('매칭관리명') || x('매칭상품명') || x('상품명'))] = 1; return o; }, {})).length,   /* 같은 제품(색상만 다름) = 1 */
            출력양식: /쉽먼트/.test(seller) ? '쉽먼트발송' : '앳댓모먼트', 발송정보: '일반', 택배크기: '극소', 송장번호: inv, 건수: 1 };
          seen[inv] = 1; fromOrd++;
          rows.push(TH.map(function(h){ return val[h] != null ? val[h] : /택배비|추가운임|퀵|해외|박스|포장|합포|에어캡/.test(h) ? 0 : ''; })); });
        rows.sort(function(a, b){ var iD = TH.indexOf('등록일'), iV = TH.indexOf('송장번호'); return String(a[iD]).localeCompare(String(b[iD])) || String(a[iV]).localeCompare(String(b[iV])); });
        replaceSheet(wb, '배송비', TH, rows);
        log.push(['자동 적용', '배송비 ' + rows.length + '건 = 쉽먼트 택배리스트 ' + fromShip + '건 + 주문목록에만 있는 송장 ' + fromOrd + '건 · 택배크기 없으면 극소']);
        if (!ship.length && !ord.length) log.push(['확인 필요', '쉽먼트 택배리스트·주문목록에 앳댓모먼트 줄이 없음 — 파일함·「이 업체 정산에 쓰는 파일」 체크 확인']);
        /* 거래명세표 옆 택배크기 피벗(T~W) 은 지난달 값 → 지움 (건수는 COUNTIF 수식) */
        for (var r = 15; r <= 30; r++) for (var c = 20; c <= 23; c++){ var cell = st.getRow(r).getCell(c); if (cell.value != null) cell.value = null; }
        return window.shipSheetFinish(wb, '배송비', st, ctx, { noSizeYellow: true });
      }).then(function(){
        /* 4) 쿠팡입고내역 */
        var L = ids('coupang_po', AT);   /* 파일 이름에 앳댓모먼트가 든 발주서만 */
        return read(L).then(function(F){
          var ws = wb.getWorksheet('쿠팡입고내역'); if (!ws) return;
          var TH = []; for (var c = 1; c <= 11; c++) TH.push(ns(ws.getRow(1).getCell(c).value));
          var rows = [], seen = {}, zero = 0, other = 0;
          F.forEach(function(f){ aoa(f.wb, ['발주번호', '물류센터', '확정수량']).forEach(function(T){ T.rows.forEach(function(r){
            var g = function(k){ var i = T.H.indexOf(k); return i >= 0 ? r[i] : ''; };
            if (ymd(g('입고예정일')).slice(0, 7) !== YM){ other++; return; }
            var k = [ns(g('발주번호')), ns(g('SKUID')), ns(g('물류센터'))].join('|'); if (seen[k]) return; seen[k] = 1;
            if (!(+g('확정수량') > 0)){ zero++; return; }
            rows.push(TH.map(function(h){ return g(h); })); }); }); });
          rows.sort(function(a, b){ return ymd(a[7]).localeCompare(ymd(b[7])); });
          /* 지난달 내용 지우고 A~K 데이터 + N~P 날짜·센터별 건수 */
          var last = Math.max(ws.rowCount, 2), dst = ws.getRow(2).getCell(1).style;
          for (var r = 2; r <= last; r++) for (var c2 = 1; c2 <= 16; c2++){ var cell = ws.getRow(r).getCell(c2); cell.value = null; }
          rows.forEach(function(v, i){ var row = ws.getRow(i + 2); v.forEach(function(x, j){ var cell = row.getCell(j + 1); cell.value = x === '' ? null : x; if (dst) cell.style = dst; }); });
          var piv = {}, dates = []; rows.forEach(function(v){ var d = ymd(v[7]), ce = String(v[6]); if (!piv[d]){ piv[d] = {}; dates.push(d); } piv[d][ce] = (piv[d][ce] || 0) + 1; });
          dates.sort(); var pr = 2;
          dates.forEach(function(d){ Object.keys(piv[d]).sort(function(a, b){ return a.localeCompare(b, 'ko'); }).forEach(function(ce, i){ var row = ws.getRow(pr++); if (!i) row.getCell(14).value = d; row.getCell(15).value = ce; row.getCell(16).value = piv[d][ce]; }); });
          var tr = ws.getRow(pr); tr.getCell(14).value = '총합계'; tr.getCell(16).value = { formula: 'SUM(P2:P' + Math.max(2, pr - 1) + ')', result: rows.length }; tr.getCell(14).font = tr.getCell(16).font = { bold: true };
          /* 거래명세표 쿠팡납품 출고건수 = 옆 표 총합계 */
          st.eachRow(function(row){ var b = ns(row.getCell(2).value) + ns(row.getCell(6).value); if (/쿠팡납품|출고건수/.test(b) && /출고건수/.test(ns(row.getCell(6).value))) row.getCell(7).value = { formula: "'쿠팡입고내역'!P" + pr, result: rows.length }; });
          log.push(['자동 적용', '쿠팡입고내역 ' + rows.length + '줄 ← 발주서 ' + F.length + '개 (입고예정일 ' + YM + ') · 날짜·센터 ' + dates.length + '일 · 출고건수 ' + rows.length]);
          if (!F.length) log.push(['확인 필요', '앳댓모먼트 쿠팡 발주서(MMDD_앳댓모먼트.xls)가 파일함에 없음 — 쿠팡납품 0']);
          if (zero) log.push(['특이사항', '쿠팡 발주서 중 확정수량 0 인 줄 ' + zero + '개는 뺌']);
          if (other) log.push(['안내', '쿠팡 발주서 중 입고예정일이 다른 달인 줄 ' + other + '개는 뺌']);
        });
      }).then(function(){
        /* 5) 타택배반품 — 직접 기입: 지난달 줄은 지움 */
        var ws = wb.getWorksheet('타택배반품'); if (!ws) return;
        var n = 0; ws.eachRow(function(row, r){ if (r < 2) return; var any = false; row.eachCell(function(c){ if (c.value != null && c.value !== '') any = true; }); if (any){ n++; row.eachCell(function(c){ c.value = null; }); } });
        log.push(['안내', '타택배반품 — 있으면 직접 기입' + (n ? ' (지난달 ' + n + '줄 지움)' : '')]);
      });
    }
  };
})();
