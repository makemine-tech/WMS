/* ============================================================
   정산관리 — 제주맥주 (2026-10-04 · 2025-12 ~ 2026-08 정산서 9개월 분석)
     공통(settle_engine_std.js):
       · 배송비 = 이벗 택배비 리스트 출력양식 「제주맥주」(누락오배송 제외)
         택배크기 = 지난달 같은 상품 조합(매칭정보)의 크기, 처음 보는 조합은 캔 수 규칙 1~17 극소 · 18~19 소 · 20~23 중 · 24~35 소 · 36~ 중
         (지난달 배움 + 규칙으로 1~8월 재현 98.4~100%) · 처음 보는 조합 중 14~23캔·미매칭은 노란 표시
       · 제주 추가운임 = 3,000 (다른 업체 400) → 제주운임추가 건수
       · 반품비 = 박스앤캔 반품 시트 「메이크창고(제주맥주)」 + 반품 참조 파일 → 극소·소 건수
       · 용차비 시트 = 화물 청구서 Sheet1 제주맥주 건 (settle_build 공통)
     제주맥주 전용(아래 after):
       · 기타출고및작업비 = 주문목록 고객사 제주맥주 (완료)
           - 택배사 「제작후직배송」(B2B) 전부: 박스 = 캔 ÷ 24 (12본입은 ÷ 12) · 출고작업비 300/박스 (받는 곳 메이크마인 = 0)
             파렛트 = 박스 25개 이상이면 100박스당 1 (올림), 그보다 적으면 비움 — 10~30박스는 노란 표시(지난달들에 1·0.5로 적은 적 있음)
           - 택배 중 선물세트(900)·디스펜서·감자칩(300) 작업 주문: 박스 = 수량
           - 맨 아래 합계: 출고비합계 → 거래명세표 기타출고비(1) 단가, 파렛트 → 파렛트출고비 수량
       · 보관비 = 전월 말일 보관파렛 + 입출고 화물관리(제주맥주) 입고·출고, 내용 칸 = 화물관리 메모
         월말 「택배출고 보정」 같은 손 보정은 특이사항으로 (8월 31일 11팔)
       · 당월말일기준재고표·메이크마인발주서 = 아직 룰 없음 (지난달 그대로 + 확인 필요)
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var R = function(t){ return { d: '2026-10-04', t: t }; };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }
  var MINE = function(v){ return /^제주맥주($|\(|_|\s)/.test(String(v || '').trim()) && !/위탁/.test(String(v)); };   /* 제주맥주위탁(만월회 등)은 따로 */
  var WORK = [[/선물세트/, 900], [/디스펜서|감자칩/, 300]];   /* 택배 주문 중 작업비가 붙는 상품 */

  function after(wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, YM = ctx.YM;
    var ids = function(t){ return Object.keys(box).filter(function(id){ return box[id].type === t; }); };
    var read = function(L){ return L.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push(x); return acc; }); }); }, Promise.resolve([])); };
    var lineRow = function(re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(ns(row.getCell(2).value))) hit = r; }); return hit; };

    /* ── 보관비 ── */
    (function(){
      var ws = wb.getWorksheet('보관비'); if (!ws) return;
      var sumR = 0; ws.eachRow(function(row, r){ var d = row.getCell(4).value; if (!sumR && r > 3 && d && typeof d === 'object' && /^SUM\(D3:/i.test(d.formula || '')) sumR = r; });
      if (!sumR){ log.push(['확인 필요', '보관비 시트 합계 줄을 못 찾음 — 지난달 그대로']); return; }
      var start = 0; for (var r0 = 3; r0 < sumR; r0++){ if (txt(ws.getCell('A' + r0).value) && txt(ws.getCell('D' + r0).value) !== '') start = +txt(ws.getCell('D' + r0).value) || 0; }
      var Y = +YM.slice(0, 4), M = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, M, 0)).getUTCDate(), S0 = Math.round(Date.UTC(Y, M - 1, 1) / 864e5) + 25569;
      var din = {}, dout = {}, tin = {}, tout = {}, n = 0;
      (ctx.CARGO || []).forEach(function(x){ if (!x || !x.date || !MINE(x.vendor)) return; var d = Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569; if (d < S0 || d >= S0 + ND) return;
        var p = (+x.aj || 0) + (+x.etc || 0), memo = String(x.memo || x.note || '').trim(); n++;
        if (x.kind === 'in'){ din[d] = (din[d] || 0) + p; (tin[d] = tin[d] || []).push((memo || '입고') + ' ' + p); }
        else if (x.kind === 'out'){ dout[d] = (dout[d] || 0) + p; (tout[d] = tout[d] || []).push((memo || '출고') + ' ' + p); } });
      var sty = ws.getRow(3).getCell(1).style, newSum = 3 + ND;
      /* 합계 줄 자리 (말일 수가 다르면 옮김) */
      var sumCells = []; ws.getRow(sumR).eachCell(function(c, k){ sumCells.push([k, c.style]); });
      for (var r1 = 3; r1 <= Math.max(sumR, newSum); r1++) ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(function(c){ ws.getCell(c + r1).value = null; });
      var cur = start, tot = 0, sin = 0, sout = 0;
      ws.getCell('D2').value = start;
      for (var i = 0; i < ND; i++){ var r = 3 + i, dd = S0 + i, bi = din[dd] || 0, co = dout[dd] || 0; cur = cur + bi - co; tot += cur; sin += bi; sout += co;
        ws.getCell('A' + r).value = dd; ws.getCell('A' + r).numFmt = 'yyyy-mm-dd'; if (sty) ws.getCell('A' + r).style = sty;
        ws.getCell('B' + r).value = bi || null; ws.getCell('C' + r).value = co || null;
        ws.getCell('D' + r).value = { formula: 'SUM(D' + (r - 1) + ',B' + r + ',-C' + r + ')', result: cur };
        ws.getCell('E' + r).value = tin[dd] ? tin[dd].join(' ') : null; ws.getCell('F' + r).value = tout[dd] ? tout[dd].join(' ') : null; }
      var L = newSum - 1;
      ws.getCell('B' + newSum).value = { formula: 'SUM(B3:B' + L + ')', result: sin }; ws.getCell('C' + newSum).value = { formula: 'SUM(C3:C' + L + ')', result: sout };
      ws.getCell('D' + newSum).value = { formula: 'SUM(D3:D' + L + ')', result: tot };
      sumCells.forEach(function(s){ if (s[1]) ws.getRow(newSum).getCell(s[0]).style = s[1]; });
      var sr = lineRow(/^보관비$/); if (sr) st.getCell('G' + sr).value = { formula: '보관비!D' + newSum, result: tot };
      log.push(['자동 적용', '보관비 시작 ' + start + '팔(지난달 말일) + 입고 ' + sin + ' − 출고 ' + sout + ' (화물관리 ' + n + '건) → 마감 ' + cur + '팔 · 파렛트×일 ' + tot]);
      log.push(['특이사항', '보관비 월말 「택배출고 보정」(택배로 나간 만큼 파렛트 빼기 — 8월 31일 11팔)과 화물관리에 없는 출고는 보관비 시트 G열에 직접']);
    })();

    /* ── 당월말일기준재고표 ← 제주맥주재고파악_MMDD (재고조사풀 stock_jeju.html 결과, 참조 파일 용도 재고) — 대표님 2026-10-04 ──
       지난달 표의 줄·이름·순서 그대로, 전산재고 = 전산 가용재고 · 실재고조사수량 = 현재실재고 · 불량재고 · 불량차감후 = 수식, 보관 파렛트수는 지난달 값(노란 칸) */
    var stockStep = function(){
      var ws = wb.getWorksheet('당월말일기준재고표'); if (!ws) return;
      var refs = (ctx.REF || []).filter(function(f){ return f.use === '재고'; }).map(function(f){ return f.m; });
      if (!refs.length) refs = Object.keys(box).filter(function(id){ return /제주맥주재고파악/.test(box[id].name); }).map(function(id){ return box[id]; });
      if (!refs.length){ log.push(['확인 필요', '제주맥주재고파악 파일(재고조사풀에서 만든 것)이 참조 파일에 없어 당월말일기준재고표는 지난달 그대로 — 📎 참조 파일(재고)로 올리기']); return; }
      return ctx.readBox(refs[refs.length - 1]).then(function(x){
        var sn = x.SheetNames.filter(function(n){ return /재고현황$/.test(n); })[0] || x.SheetNames[0], a = XLSX.utils.sheet_to_json(x.Sheets[sn], { header: 1, defval: '' }), h = -1;
        for (var i = 0; i < Math.min(a.length, 12); i++){ var hh = a[i].map(ns); if (hh.indexOf('상품명') >= 0 && hh.indexOf('현재실재고') >= 0){ h = i; break; } }
        if (h < 0){ log.push(['확인 필요', '재고파악 파일에서 「상품명·현재실재고」 머리줄을 못 찾음 — 당월말일기준재고표 지난달 그대로']); return; }
        var H = a[h].map(ns), iN = H.indexOf('상품명'), iE = H.indexOf('현재실재고'), iB = H.indexOf('불량재고'), iC = H.indexOf('전산가용재고'), src = {}, used = {};
        a.slice(h + 1).forEach(function(r){ var n = String(r[iN] || '').trim(); if (!n || /^(합계|총합계)$/.test(n)) return; src[ns(n)] = { name: n, real: +r[iE] || 0, bad: iB >= 0 ? +r[iB] || 0 : 0, erp: iC >= 0 && r[iC] !== '' ? +r[iC] || 0 : null }; });
        var TH = []; ws.getRow(1).eachCell(function(c, k){ TH[k] = ns(c.value); }); var col = function(t){ return TH.indexOf(t); };
        var cA = col('상품명'), cC = col('전산재고'), cD = col('실재고조사수량'), cE = col('불량재고'), cF = col('불량차감후실재고'), cG = col('보관파렛트수'), cH = col('비고');
        var n = 0, nDiff = 0, miss = [];
        ws.eachRow(function(row, r){ if (r < 2) return; var nm = ns(row.getCell(cA).value); if (!nm) return; var s = src[nm]; if (!s) return; used[nm] = 1; n++;
          var L = function(c){ return ws.getColumn(c).letter; };
          row.getCell(cC).value = s.erp != null ? s.erp : s.real; row.getCell(cD).value = s.real;
          row.getCell(cE).value = s.bad || null; row.getCell(cF).value = s.bad ? { formula: 'SUM(' + L(cD) + r + '-' + L(cE) + r + ')', result: s.real - s.bad } : null;
          if (s.erp != null && s.erp !== s.real){ nDiff++; if (cH > 0) row.getCell(cH).value = '전산 ' + s.erp.toLocaleString() + ' · 실재고 ' + s.real.toLocaleString() + ' (차이 ' + (s.real - s.erp > 0 ? '+' : '') + (s.real - s.erp) + ')';
            row.getCell(cD).style = Object.assign({}, row.getCell(cD).style, { fill: YEL }); }
          else if (cH > 0 && /전산|차이/.test(txt(row.getCell(cH).value))) row.getCell(cH).value = null;
          if (cG > 0 && row.getCell(cG).value != null && row.getCell(cG).value !== '') row.getCell(cG).style = Object.assign({}, row.getCell(cG).style, { fill: YEL }); });
        Object.keys(src).forEach(function(k){ if (!used[k] && (src[k].real || src[k].erp)) miss.push(src[k].name + ' ' + src[k].real.toLocaleString()); });
        log.push(['자동 적용', '당월말일기준재고표 ← ' + (refs[refs.length - 1].name || '재고파악') + ' 「' + sn + '」 ' + n + '품목 (전산재고·실재고·불량) · 보관 파렛트수는 지난달 값(노란 칸 — 확인)']);
        if (nDiff) log.push(['특이사항', '당월말일기준재고표 실재고 ≠ 전산 ' + nDiff + '품목 (노란 칸·비고) — 재고조사풀 점검내역 확인']);
        if (miss.length) log.push(['특이사항', '재고파악에는 있는데 당월말일기준재고표에 줄이 없는 상품: ' + miss.join(', ') + ' — 필요하면 직접 줄 추가']);
      });
    };

    /* ── 기타출고및작업비 ── */
    return Promise.resolve(stockStep()).then(function(){ return read(ids('ebut_orders')); }).then(function(F){
      var ws = wb.getWorksheet('기타출고및작업비'); if (!ws) return;
      var TH = []; ws.getRow(1).eachCell({ includeEmpty: true }, function(c, k){ TH[k - 1] = ns(c.value); });
      var at = function(h){ return TH.indexOf(h); };
      var cZ = at('가용수량'), cAA = at('출고작업비'), cAB = at('출고비합계'), cAC = at('전표파렛트출고수'), cAD = at('비고');
      var rows = [], seen = {}, flag = [], orderSeen = {}, skipEtc = {}, nonBev = [];
      F.forEach(function(x){ var a = XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return; var H = a[0].map(ns), g = function(r, h){ var i = H.indexOf(h); return i >= 0 ? r[i] : ''; };
        a.slice(1).forEach(function(r){ if (!MINE(g(r, '고객사'))) return; if (String(g(r, '상태')) !== '완료') return; var k = ns(g(r, 'NO')) || r.join('\u0001'); if (seen[k]) return; seen[k] = 1;
          var b2b = /제작후직배송/.test(String(g(r, '택배사'))), nm = String(g(r, '상품명')), w = null;
          if (!b2b){ for (var j = 0; j < WORK.length; j++) if (WORK[j][0].test(nm)){ w = WORK[j][1]; break; } if (w == null) return;
            /* 작업 택배 = 주문(코드) 1건 = 1줄 (9월 주문목록은 매칭 상품마다 줄이 나뉨 — 8월 확정본은 주문당 1줄) */
            var oc = ns(g(r, '코드')) || ns(g(r, '주문번호')); if (oc){ if (orderSeen[oc]) return; orderSeen[oc] = 1; }
            /* 판매처 「제주맥주 기타/M」(직원·샘플 발송 등)은 8월 확정본에서 빠짐 → 빼고 특이사항 */
            if (/기타\/?M/i.test(String(g(r, '판매처')))){ var sk = nm.slice(0, 30); skipEtc[sk] = (skipEtc[sk] || 0) + 1; return; } }
          var v = TH.map(function(h, c){ return c < cZ ? g(r, h) : ''; });
          if (!b2b && v[at('매칭상품명')] !== undefined){ v[at('매칭상품명')] = nm; v[at('매칭수량')] = +g(r, '수량') || 1; }   /* 세트 이름으로 */
          var q = +g(r, '매칭수량') || +g(r, '수량') || 0, to = String(g(r, '수령자')).trim();
          var mp = String(g(r, '매칭상품명'));
          if (b2b && !/JB00[1-3]|톡쏘다|누보/.test(mp)){   /* 맥주가 아닌 직배송(감자칩·코스터·잔·감귤칩 …) — 지난달들에 기준 없음(6월 화투 = 0) → 0 + 특이사항 */
            v[cZ] = 0; v[cAA] = 300; v[cAD] = to; nonBev.push(String(g(r, '상품명')).slice(0, 20) + ' ' + q + '(' + to + ')'); rows.push(v); return; }
          if (b2b){ var per = /12본입|12캔/.test(nm) ? 12 : 24, bx = Math.round(q / per * 100) / 100; v[cZ] = bx; v[cAA] = /메이크마인/.test(to) ? 0 : 300;
            v[cAC] = bx >= 25 ? Math.ceil(bx / 100) : ''; if (bx >= 10 && bx < 30) flag.push(rows.length); }
          else { v[cZ] = +g(r, '수량') || 1; v[cAA] = w; }
          v[cAD] = b2b ? to : '';
          rows.push(v); }); });
      /* 시트 다시 쓰기 (합계 줄 = 맨 아래) */
      var last = ws.rowCount, sty = []; for (var c0 = 1; c0 <= TH.length; c0++) sty[c0] = ws.getRow(2).getCell(c0).style;
      for (var r = 2; r <= last; r++) ws.getRow(r).eachCell({ includeEmpty: false }, function(c){ c.value = null; });
      var colL = function(c){ return ws.getColumn(c + 1).letter; };
      rows.forEach(function(v, i){ var row = ws.getRow(2 + i);
        v.forEach(function(x, c){ if (x === '' || x == null) return; var cell = row.getCell(c + 1); cell.value = x; if (sty[c + 1]) cell.style = sty[c + 1]; });
        row.getCell(cAB + 1).value = { formula: 'PRODUCT(' + colL(cZ) + (2 + i) + ':' + colL(cAA) + (2 + i) + ')', result: (+v[cZ] || 0) * (+v[cAA] || 0) };
        if (flag.indexOf(i) >= 0) row.getCell(cAC + 1).style = Object.assign({}, row.getCell(cAC + 1).style, { fill: YEL }); });
      var sR = 2 + rows.length, sAB = rows.reduce(function(s, v){ return s + (+v[cZ] || 0) * (+v[cAA] || 0); }, 0), sAC = rows.reduce(function(s, v){ return s + (+v[cAC] || 0); }, 0);
      ws.getRow(sR).getCell(cAB + 1).value = { formula: 'SUM(' + colL(cAB) + '2:' + colL(cAB) + (sR - 1) + ')', result: sAB };
      ws.getRow(sR).getCell(cAC + 1).value = { formula: 'SUM(' + colL(cAC) + '2:' + colL(cAC) + (sR - 1) + ')', result: sAC };
      var r25 = lineRow(/^기타출고비/), r26 = lineRow(/^파렛트출고비/);
      if (r25) st.getCell('H' + r25).value = { formula: '기타출고및작업비!' + colL(cAB) + sR, result: sAB };
      if (r26) st.getCell('G' + r26).value = { formula: '기타출고및작업비!' + colL(cAC) + sR, result: sAC };
      var nB = rows.filter(function(v){ return v[cAD] !== ''; }).length;
      log.push(['자동 적용', '기타출고및작업비 ← 주문목록 제주맥주 ' + rows.length + '줄 (B2B 직배송 ' + nB + ' · 작업 택배 ' + (rows.length - nB) + ') · 출고비합계 ' + sAB.toLocaleString() + ' · 파렛트 ' + sAC]);
      if (nonBev.length) log.push(['특이사항', '맥주가 아닌 B2B 직배송 ' + nonBev.length + '줄은 박스 0으로 둠(기준 없음) — 출고작업비를 받을 것이면 기타출고및작업비 시트 박스 칸에 직접: ' + nonBev.join(', ')]);
      var ek = Object.keys(skipEtc); if (ek.length) log.push(['특이사항', '판매처 「제주맥주 기타/M」 작업 주문은 뺌(8월 확정본 기준) — 청구할 것이면 직접: ' + ek.map(function(k){ return k + ' ' + skipEtc[k] + '건'; }).join(', ')]);
      if (rows.some(function(v){ return v[cAD] !== '' && !(+v[cZ]); })) log.push(['특이사항', 'B2B 줄 중 매칭수량이 없어 박스 수를 못 낸 줄이 있음 — 주문목록 매칭 확인']);
      if (flag.length) log.push(['특이사항', 'B2B 출고 10~30박스 ' + flag.length + '건은 파렛트 수(노란 칸) 확인 — 지난달들에 1·0.5·빈칸으로 다르게 적힘']);
    });
  }

  E['제주맥주'] = window.SETTLE_STD({ name: '제주맥주', shipSheet: '배송비', needs: ['ebut_shiplist', 'ebut_orders', 'bnc_courier', 'freight'],
    sheets: { '배송비': 'skip', '보관비': 'skip' }, ownSheets: /^(기타출고및작업비|반품비|당월말일기준재고표)$/, noStore: true,
    sizeLearn: true, sizeByQty: [[17, '극소'], [19, '소'], [23, '중'], [35, '소'], [1e9, '중']], sizeFlag: function(q){ return !q || (q >= 14 && q <= 23); }, sizeDefault: '극소',
    jejuFee: 3000, returns: { sheet: '반품비', who: /\(제주맥주\)/, bySize: true },
    items: { 8: 'auto', 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto', 13: 'auto', 15: 'auto', 16: 'auto', 20: 'auto', 25: 'auto', 26: 'auto', 19: 'fixed', 23: 'fixed' },   /* 23 용차비 = 수량 1 × 용차비 시트 합계 */
    /* ✅ 7월 확정본 + 8월 원본(크기 비운 8월 배송비)으로 8월 재현: 택배 극소 1430·소 500·중 16 · 제주 3,000 × 44 · 용차비 610,000 일치 (2026-10-04) */
    verified: { 8: true, 9: true, 10: true, 11: true, 12: true, 13: true, 23: true }, verifiedSheets: /^(배송비|용차비)$/,
    after: after,
    ruleList: [R('배송비 = 이벗 택배비 리스트 출력양식 「제주맥주」 · 택배크기 = 지난달 같은 상품 조합의 크기, 처음 보는 조합은 캔 수(1~17 극소 · 18~19 소 · 20~23 중 · 24~35 소 · 36~ 중), 14~23캔·미매칭 노란 표시'),
      R('제주 추가운임 3,000 → 제주운임추가 · 반품비 극소·소 = 박스앤캔 반품(메이크창고(제주맥주)) + 반품 참조 파일'),
      R('기타출고및작업비 = 주문목록 제주맥주: B2B 제작후직배송(박스 = 캔÷24, 12본입 ÷12 · 300/박스 · 메이크마인 0 · 파렛트 = 25박스 이상 100박스당 1) + 선물세트 900 · 디스펜서·감자칩 300 → 기타출고비(1)·파렛트출고비'),
      R('보관비 = 전월 말일 보관파렛 + 화물관리 입고·출고(메모를 내용 칸에), 월말 택배출고 보정은 직접 · 용차비 = 화물 청구서 제주맥주 건 · 연동솔루션 매달 그대로'),
      R('당월말일기준재고표 = 참조 파일(재고) 제주맥주재고파악_MMDD(재고조사풀에서 마감한 파일): 전산재고 = 전산 가용 · 실재고조사수량 = 현재실재고 · 불량재고 · 불량차감후 = 수식, 줄·이름은 지난달 표 그대로, 보관 파렛트수는 지난달 값(노란 칸)')] });
})();
