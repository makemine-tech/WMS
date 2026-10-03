/* ============================================================
   정산관리 — 포인트나인크루 본 정산서 업체 설정·자동 처리 (settle_engines.js 와 같은 형식)
   룰은 2026-10-03 대표님 문답으로 정함. 바꿀 땐 대화창에서 요청 → 여기 고치고 ruleList 에 추가.

   지난달 완료본(표본)을 틀로:
     · 곡·셀·오 ROW데이터 = 이번 달 파일함 「포인트나인크루 출고 ROW」(00_곡물도감·00_셀시어스·00_오리진케어) WorkSheet 그대로
     · 곡·셀·오 작업상세 = 그 ROW 에서 우체국택배 송장만 모은 송장×상품 표 + 박스수·포장구분·포장비·소분포장, 오른쪽 요약표(일반 수식)
     · 작업비정산서 = 작업상세 요약표를 가리킴 (피벗 없음)
     · 기타작업내역 = 「쿠팡 발주서」(0930_포인트나인크루) Sheet1, 작업금액 = 박스수 × 작업비(단가) × 1.1
     · 곡·셀·오 보관비 = 그 달 일수, 단가 (17500×1.1)/일수, 입고·파렛트출고 = 「화물 입출고 엑셀」, 택배 파렛트 = 송장 건수 비례로 마감 재고에 맞춤
     · 택배착불및기타비용 = MONTHS[정산월].cod (대표님 메모) + 번개배송 송장당 1,500 + 이벗 주문목록 메이크창고·로켓쉽먼트_다이렉트·포인트나인 상품 송장별 한 줄(비용은 대표님 입력)
   달마다 넣는 값(시작·마감 파렛트, 착불 메모)은 MONTHS 에 — 대화창에서 알려 주시면 넣음.
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } }, NOFILL = { type: 'pattern', pattern: 'none' };
  var THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } }, BOX4 = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  var ADJ = { 곡: 20, 셀: 6, 오: 10 };                                   /* 부자재 파렛트 (창고관리에 없음) */
  var BRAND = { 곡: '곡물도감', 셀: '셀시어스', 오: '오리진케어' };
  var P9_ITEM = /곡물도감|그래놀라|Granola|서리태|콩물|두유|카무트|비움|맷돌|당쉼|오리진|혈당컷|결명자|셀시어스|OTG/;   /* 포인트나인 상품 */

  /* 달마다 넣는 값: start = 창고관리 전달 말일 + 부자재, end = 그달 말 재고조사 + 부자재, cod = [일, 내용, 건수, 건당비용] */
  var MONTHS = {
    '2026-09': { start: { 곡: 534, 셀: 8, 오: 168 }, end: { 곡: 1120, 셀: 8, 오: 104 },
                 cod: [[14, '포인트나인 롯데 착불 (2건 합계 5,200원)', 2, 2600]] }
  };

  /* ── 곡물도감 포장비 ── 박스 15입1·30입2·45입3·60입4, S·C·A팩·그래놀라(낱개/세트/10개포장)·Pack 각 1 */
  function gokFee(H, r){
    var soy = [], box = 0, pre = 0, nonSoy = false, extra = 0, hasS = false, g = {};
    H.forEach(function(h, i){ var q = +r[i] || 0; if (!i || !q) return;
      var m = h.match(/(15|30|45|60)입/);
      if (m){ var b = { 15: 1, 30: 2, 45: 3, 60: 4 }[m[1]]; soy.push({ q: q, b: b }); box += b * q; return; }
      if (/추가송장/.test(h)){ extra += q; return; }
      nonSoy = true;
      if (/^Granola/.test(h)){ g[h] = q; return; }
      if (/^[SCA] /.test(h)){ if (/^S /.test(h)) hasS = true; box += q; pre += q; return; }
      box += q; });                                                    /* Pack 구성 등: 박스 1, 소분 없음 */
    var gk = Object.keys(g);
    if (gk.length === 4 && gk.every(function(k){ return g[k] === 1; })){ box += 1; pre += 1; }
    else gk.forEach(function(k){ var q = g[k]; if (q === 1) box += 1; else { var p = Math.ceil(q / 10); box += p; pre += p; } });
    if (!soy.length && !nonSoy) return extra ? { fee: 300, pre: 0, kind: '추가송장', box: 0 } : { fee: 0, pre: 0, kind: '빈줄', box: 0 };
    if (!nonSoy && soy.length === 1){ var s = soy[0];
      if (s.q === 1) return { fee: s.b === 4 ? 1500 : 300, pre: 0, kind: s.b === 4 ? '60입단독' : '완박스', box: box };
      return { fee: box <= 2 ? 300 : box === 3 ? 1000 : 1500, pre: 0, kind: '같은상품' + box + '박스', box: box }; }
    if (hasS && box > 1) return { fee: 1500, pre: pre, kind: 'S팩합포', box: box };
    return { fee: box <= 2 ? 1000 : 1500, pre: pre, kind: box <= 2 ? '합포1000' : '합포1500', box: box };
  }
  /* ── 오리진케어 포장비 ── 완제품 1개 300 · 1병 1~6 1000 / 7+ 1500 · OTG 1000 · OTG+1병 1000 · 추가송장 300 */
  function oriFee(H, r){
    var c = { 병: 0, OTG: 0, 완제품: 0, 추가: 0 };
    H.forEach(function(h, i){ var q = +r[i] || 0; if (!i || !q) return; c[/^1병/.test(h) ? '병' : /OTG/.test(h) ? 'OTG' : /추가송장/.test(h) ? '추가' : '완제품'] += q; });
    if (c.완제품 === 1 && !c.병 && !c.OTG && !c.추가) return { fee: 300, kind: '완박스' };
    if (c.OTG && c.병 && !c.완제품) return { fee: 1000, kind: 'OTG+1병' };
    if (c.OTG && !c.병 && !c.완제품) return { fee: 1000, kind: 'OTG' };
    if (c.병 && !c.OTG && !c.완제품) return c.병 <= 6 ? { fee: 1000, kind: '1병 1~6' } : { fee: 1500, kind: '1병 7+' };
    if (c.추가 && !c.병 && !c.OTG && !c.완제품) return { fee: 300, kind: '추가송장' };
    if (!c.병 && !c.OTG && !c.완제품 && !c.추가) return { fee: 0, kind: '빈줄' };
    return { fee: 1000, kind: '기타섞임' };
  }

  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); return v == null ? '' : String(v); }
  function toSerial(v){ if (typeof v === 'number') return Math.floor(v); var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) + 25569 : null; }
  function fresh(wb, name){
    var old = wb.getWorksheet(name); if (!old) return wb.addWorksheet(name);
    var ord = old.orderNo, widths = (old.columns || []).map(function(c){ return c.width; }), views = old.views;
    wb.removeWorksheet(old.id);
    var ws = wb.addWorksheet(name, { views: views }); ws.orderNo = ord;
    widths.forEach(function(w, i){ if (w) ws.getColumn(i + 1).width = w; });
    return ws;
  }
  function brandOf(meta, aoa){
    var n = String(meta.name || '');
    for (var b in BRAND) if (n.indexOf(BRAND[b]) >= 0) return b;
    var s = aoa.slice(1, 200).map(function(r){ return r.join(' '); }).join(' ');
    return /셀시어스/.test(s) ? '셀' : /당쉼|오리진/.test(s) ? '오' : /곡물|Granola|서리태/.test(s) ? '곡' : null;
  }

  /* ── 표 모양 (2026-10-03 대표님 요청: 전체 디자인 정리) ──
     글꼴 맑은 고딕 10 · 제목줄 진한 남색 + 흰 글씨 · 합계줄 연한 남색 + 굵게 · 연회색 가는 테두리 · 눈금선 끔
     숫자 천 단위 쉼표(번호류 제외) · 열 너비 내용 맞춤 · 제목줄 고정 + 필터 · 시트 탭 색(곡 초록·셀 주황·오 보라) */
  var C_HEAD = 'FF1F3A5F', C_TOT = 'FFE7EDF6', C_LINE = 'FFD0D7E2', C_TXT = 'FF262626';
  var HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEAD } }, TOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_TOT } };
  var LINE = { style: 'thin', color: { argb: C_LINE } }, BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE };
  var TOT_BORDER = { top: { style: 'medium', color: { argb: C_HEAD } }, left: LINE, bottom: { style: 'medium', color: { argb: C_HEAD } }, right: LINE };
  var F_BODY = { name: '맑은 고딕', size: 10, color: { argb: C_TXT } }, F_HEAD = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  var F_TOT = { name: '맑은 고딕', size: 10, bold: true, color: { argb: C_HEAD } }, F_TITLE = { name: '맑은 고딕', size: 14, bold: true, color: { argb: C_HEAD } };
  var A_HEAD = { horizontal: 'center', vertical: 'middle', wrapText: true };
  var A_L = { horizontal: 'left', vertical: 'middle' }, A_R = { horizontal: 'right', vertical: 'middle' }, A_C = { horizontal: 'center', vertical: 'middle' };
  var TAB = { 곡: 'FF548235', 셀: 'FFC55A11', 오: 'FF7030A0' }, TAB_ETC = 'FF595959';
  var ID_COL = /번호|코드|Barcode|ID|우편|전화/;
  function styleHead(row, maxC, c1){ for (var c = c1 || 1; c <= maxC; c++){ var cl = row.getCell(c); cl.fill = HEAD_FILL; cl.border = BORDER; cl.font = F_HEAD; cl.alignment = A_HEAD; } }
  function styleTot(row, maxC, c1){ for (var c = c1 || 1; c <= maxC; c++){ var cl = row.getCell(c); cl.fill = TOT_FILL; cl.border = TOT_BORDER; cl.font = F_TOT; } }
  function boxAll(ws, r1, r2, maxC, c1){ for (var r = r1; r <= r2; r++){ var row = ws.getRow(r); for (var c = c1 || 1; c <= maxC; c++) row.getCell(c).border = BORDER; } }
  function lastCol(ws, r){ var m = 0; ws.getRow(r).eachCell(function(c, n){ if (c.value != null && c.value !== '') m = Math.max(m, n); }); return m; }
  function lastRow(ws, c1, c2){ var m = 0; ws.eachRow(function(row, r){ for (var c = c1; c <= c2; c++){ var v = row.getCell(c).value; if (v != null && v !== ''){ m = r; break; } } }); return m; }
  function valOf(v){ if (!v || typeof v !== 'object' || v instanceof Date) return v; if ('result' in v || v.formula || v.sharedFormula) return v.result; if (v.richText) return txt(v); if (v.text != null) return v.text; return v; }
  function dispLen(v){ v = valOf(v); if (v == null) return 0; if (v instanceof Date) return 10; if (typeof v === 'number') return Math.round(v).toLocaleString('en-US').length + 1;
    var s = String(v), n = 0; for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2E80 ? 1.8 : 1; return n; }
  function isDateFmt(f){ return /(^|[^"])(yy|mm|dd|m"|d")/.test(f || '') || /[md]"[월일]"/.test(f || ''); }
  /* 표 한 개 본문(머리줄 hr, 몸통 r1~r2, 열 c1~c2): 글꼴·정렬·숫자 서식·테두리 — 노란 칸 등 채우기는 그대로 둠 */
  function body(ws, hr, r1, r2, c1, c2){
    var kind = {};
    for (var c = c1; c <= c2; c++) kind[c] = ID_COL.test(txt(ws.getRow(hr).getCell(c).value)) ? 'id' : '';
    for (var r = r1; r <= r2; r++){ var row = ws.getRow(r);
      for (var k = c1; k <= c2; k++){ var cl = row.getCell(k), v = valOf(cl.value), f = cl.numFmt || '';
        var yel = cl.fill && cl.fill.fgColor && cl.fill.fgColor.argb === 'FFFFF2B3';
        cl.style = { numFmt: f || undefined, font: F_BODY, border: BORDER, fill: yel ? YEL : undefined, alignment: cl.alignment };
        if (cl.isMerged && cl.master !== cl) continue;
        if (v instanceof Date || (typeof v === 'number' && isDateFmt(f))){ cl.alignment = A_C; continue; }
        if (typeof v === 'number'){
          if (kind[k] === 'id'){ cl.numFmt = '0'; cl.alignment = A_C; }
          else { if (!f || f === 'General' || /\$|_\(|0_\)|_-|0_ /.test(f)) cl.numFmt = '#,##0'; cl.alignment = A_R; }
        } else if (v != null && v !== '') cl.alignment = cl.alignment && cl.alignment.horizontal === 'center' ? A_C : A_L;
      } }
  }
  function fitCols(ws, r1, r2, c1, c2, min, max){
    var stop = Math.min(r2, r1 + 600);
    for (var c = c1; c <= c2; c++){ var w = 0; for (var r = r1; r <= stop; r++){ var cl = ws.getRow(r).getCell(c); if (cl.isMerged && cl.master !== cl) continue; w = Math.max(w, dispLen(cl.value)); }
      ws.getColumn(c).width = Math.max(min || 6, Math.min(max || 40, Math.ceil(w + 2))); }
  }
  function look(ws, tab, frz){ ws.properties.tabColor = { argb: tab };
    ws.views = [frz ? { state: 'frozen', xSplit: frz[0], ySplit: frz[1], topLeftCell: ws.getColumn(frz[0] + 1).letter + (frz[1] + 1), activeCell: 'A1', showGridLines: false, zoomScale: 100 }
                    : { state: 'normal', activeCell: 'A1', topLeftCell: 'A1', showGridLines: false, zoomScale: 100 }]; }
  /* 엑셀에서 읽은 칸들은 서식 객체를 같이 쓰는 경우가 있어(한 칸을 칠하면 다른 칸도 바뀜) 칸마다 따로 복사 */
  function unshare(wb){ wb.eachSheet(function(ws){ ws.eachRow(function(row){ row.eachCell({ includeEmpty: true }, function(cl){ if (cl.style) cl.style = JSON.parse(JSON.stringify(cl.style)); }); }); }); }
  function beautify(wb){
    ['곡', '셀', '오'].forEach(function(b){
      /* ROW데이터: 원본 그대로 · 머리줄 고정 + 필터 */
      var ws = wb.getWorksheet(b + '_ROW데이터');
      if (ws){ var mc = lastCol(ws, 1), lr = ws.rowCount;
        styleHead(ws.getRow(1), mc); ws.getRow(1).height = 24; ws.getColumn(1).numFmt = 'yyyy-mm-dd'; body(ws, 1, 2, lr, 1, mc);
        fitCols(ws, 1, lr, 1, mc, 7, 42); ws.getColumn(1).width = 12;
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: mc } }; look(ws, TAB[b], [0, 1]); }
      /* 작업상세: 송장×상품 표 + 오른쪽 요약표 */
      ws = wb.getWorksheet(b + '_작업상세');
      if (ws){ var hc = 0, sc = 0; ws.getRow(1).eachCell(function(c, k){ var t = txt(c.value); if (t === '소분포장') hc = k; if (t === '포장비 구분') sc = k; });
        var lr2 = ws.rowCount, mc2 = hc || lastCol(ws, 1);
        styleHead(ws.getRow(1), mc2); ws.getRow(1).height = 66; body(ws, 1, 2, lr2, 1, mc2);
        ws.getColumn(1).width = 16; ws.getColumn(2).width = 9; for (var c = 3; c <= mc2 - 4; c++) ws.getColumn(c).width = 11;
        ws.getColumn(mc2 - 3).width = 8; ws.getColumn(mc2 - 2).width = 18; ws.getColumn(mc2 - 1).width = 9; ws.getColumn(mc2).width = 9;
        for (var r = 2; r <= lr2; r++){ var row = ws.getRow(r); row.getCell(1).alignment = A_C; for (var c3 = 3; c3 <= mc2 - 3; c3++) row.getCell(c3).alignment = A_C; row.getCell(mc2 - 2).alignment = A_C; row.getCell(mc2).alignment = A_C; }
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: mc2 } };
        if (sc){ var sr = 1; while (txt(valOf(ws.getRow(sr + 1).getCell(sc).value))) sr++;
          ws.getColumn(sc - 1).width = 3; styleHead(ws.getRow(1), sc + 3, sc); body(ws, 1, 2, sr, sc, sc + 3); styleTot(ws.getRow(sr), sc + 3, sc);
          ws.getColumn(sc).width = 22; ws.getColumn(sc + 1).width = 10; ws.getColumn(sc + 2).width = 8; ws.getColumn(sc + 3).width = 14; }
        look(ws, TAB[b], [2, 1]); }
      /* 보관비: 1~2행 제목, 3~5행 머리, 날짜 표, 합계줄, 오른쪽 화물 목록 */
      ws = wb.getWorksheet(b + '_보관비');
      if (ws){ var w = b === '곡' ? 10 : 9, sumR = 0; ws.eachRow(function(row, r){ if (txt(row.getCell(1).value) === '합계') sumR = r; });
        var t = ws.getCell('A1'); t.font = F_TITLE; t.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }; t.fill = NOFILL; t.border = {};
        for (var r2 = 3; r2 <= 5; r2++){ styleHead(ws.getRow(r2), w); ws.getRow(r2).height = 20; } ws.getRow(1).height = 32; ws.getRow(2).height = 16;
        body(ws, 5, 6, (sumR || 37) - 1, 1, w);
        ws.getCell('B6').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; if (b === '곡') ws.getCell('C6').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; ws.getRow(6).height = 30;
        if (sumR){ body(ws, 5, sumR, sumR, 1, w); styleTot(ws.getRow(sumR), w); ws.getCell('A' + sumR).alignment = A_C;
          var nt = ws.getCell('A' + (sumR + 1)); nt.font = { name: '맑은 고딕', size: 9, italic: true, color: { argb: 'FF7F7F7F' } }; nt.fill = NOFILL; nt.border = {}; nt.alignment = { horizontal: 'left', vertical: 'middle' };
          for (var r8 = sumR + 1; r8 <= sumR + 3; r8++) for (var c5 = 1; c5 <= w; c5++){ var z = ws.getRow(r8).getCell(c5); if (r8 > sumR + 1 || c5 > 1) z.style = {}; } }
        for (var r3 = 6; r3 <= (sumR || 37); r3++) ws.getCell('A' + r3).alignment = A_C;
        ws.getColumn(1).width = 10; ws.getColumn(2).width = b === '곡' ? 20 : 46; if (b === '곡') ws.getColumn(3).width = 14;
        for (var c4 = b === '곡' ? 4 : 3; c4 <= w; c4++) ws.getColumn(c4).width = 11;
        var lr3 = lastRow(ws, 12, 16);
        if (lr3 >= 1 && txt(ws.getCell('L1').value)){ ws.getColumn(11).width = 3; styleHead(ws.getRow(1), 16, 12); body(ws, 1, 2, lr3, 12, 16);
          [8, 10, 30, 9, 9].forEach(function(x, i){ ws.getColumn(12 + i).width = x; }); for (var r4 = 2; r4 <= lr3; r4++){ ws.getCell('L' + r4).alignment = A_C; ws.getCell('M' + r4).alignment = A_C; } }
        look(ws, TAB[b], [0, 5]); }
    });
    /* 기타작업내역 · 착불 · 오포장 */
    ['기타작업내역', '택배착불및기타비용', '오포장'].forEach(function(n){ var ws = wb.getWorksheet(n); if (!ws) return;
      var mc = lastCol(ws, 1), lr = Math.max(2, lastRow(ws, 1, mc)); styleHead(ws.getRow(1), mc); ws.getRow(1).height = 24;
      body(ws, 1, 2, lr, 1, mc);
      var tr = 0; for (var r = 2; r <= lr; r++) if (txt(ws.getRow(r).getCell(1).value) === '합계') tr = r;
      if (n === '택배착불및기타비용' && lr > 2){ tr = lr; ws.getCell('A' + tr).value = '합계'; }
      if (tr){ styleTot(ws.getRow(tr), mc); ws.getCell('A' + tr).alignment = A_C; }
      if (n === '기타작업내역'){ [14, 9, 9, 11, 40, 15, 12, 11, 16, 9, 9, 8, 9, 9, 9, 12, 26].forEach(function(x, i){ ws.getColumn(i + 1).width = x; });
        for (var r5 = 2; r5 < (tr || lr + 1); r5++) ['A', 'B', 'C', 'D', 'F', 'G', 'H', 'I', 'M'].forEach(function(c){ var cl = ws.getCell(c + r5); if (!(cl.isMerged && cl.master !== cl)) cl.alignment = A_C; });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: mc } }; }
      else if (n === '택배착불및기타비용'){ [11, 70, 8, 12, 14].forEach(function(x, i){ ws.getColumn(i + 1).width = x; });
        for (var r6 = 2; r6 <= (tr || lr); r6++){ ws.getCell('A' + r6).alignment = A_C; if (r6 < tr) ws.getCell('B' + r6).alignment = A_L; ws.getCell('C' + r6).alignment = A_C; ws.getCell('D' + r6).numFmt = '#,##0'; ws.getCell('E' + r6).numFmt = '#,##0'; } }
      else fitCols(ws, 1, lr, 1, mc, 9, 40);
      look(ws, TAB_ETC, [0, 1]);
    });
    /* 청구내역서·작업비정산서: 양식은 그대로, 글꼴(굴림·Calibri → 맑은 고딕)·탭 색·화면만 */
    ['청구내역서', '작업비정산서'].forEach(function(n){ var ws = wb.getWorksheet(n); if (!ws) return;
      ws.eachRow(function(row){ row.eachCell(function(cl){ var f = cl.font; if (f && /굴림|Calibri|돋움|Arial/.test(f.name || '')) cl.font = Object.assign({}, f, { name: '맑은 고딕' }); }); });
      if (n === '작업비정산서') for (var r7 = 9; r7 <= 22; r7++) ws.getRow(r7).eachCell(function(cl){ var v = valOf(cl.value); if (typeof v === 'number' && (!cl.numFmt || cl.numFmt === 'General')) cl.numFmt = '#,##0'; });
      look(ws, C_HEAD); });
  }


  E['포인트나인크루'] = {
    items: { 6: 'auto', 22: 'auto', 23: 'auto', 25: 'auto', 27: 'auto', 38: 'auto' },
    sheets: { '곡_ROW데이터': 'skip', '곡_작업상세': 'skip', '곡_보관비': 'skip', '셀_ROW데이터': 'skip', '셀_작업상세': 'skip', '셀_보관비': 'skip',
              '오_ROW데이터': 'skip', '오_작업상세': 'skip', '오_보관비': 'skip', '기타작업내역': 'skip', '택배착불및기타비용': 'skip', '오포장': 'skip', '작업비정산서': 'skip' },
    verified: {},
    opt: { checkSheet: false },
    months: MONTHS,
    gokFee: gokFee, oriFee: oriFee,
    ruleList: [
      { d: '2026-10-03', t: '곡·셀·오 ROW데이터 = 이번 달 출고 ROW(00_곡물도감·00_셀시어스·00_오리진케어) 그대로. 작업상세는 우체국택배 송장만(쿠팡로켓 퀵서비스 가상송장·해외 번개배송 제외)' },
      { d: '2026-10-03', t: '곡물도감 포장비(송장별): 박스 = 15입1·30입2·45입3·60입4, S팩·C팩·그래놀라 낱개·그래놀라 4종세트·그래놀라 10개포장·Pack 각 1박스' },
      { d: '2026-10-03', t: '곡물도감: 한 상품 1개(15·30·45입) = 완박스 300 · 60입 단독 1,500 · 같은 상품 여러 개 2박스 300 / 3박스 1,000 / 4박스↑ 1,500' },
      { d: '2026-10-03', t: '곡물도감: 그 밖(개봉·내품 추가) 1~2박스 1,000 · 3박스↑ 1,500 · S팩이 다른 것과 같이면 1,500 · S팩·C팩·그래놀라만 1,000 · 추가송장만 300' },
      { d: '2026-10-03', t: '소분포장(선작업) 300원: S팩·C팩 개당, 그래놀라 4종 각1 = 1, 한 맛 2개↑ = 10개 단위 올림, 낱개 1개는 소분 아님 — 송장 금액에 붙이지 않고 월 건수×300 따로 한 줄' },
      { d: '2026-10-03', t: '오리진케어: 완제품(당쉼·검은콩·결명자·스파클링24입) 1개 300 · 1병 1~6병 1,000 / 7병↑ 1,500 · OTG(몇 개든) 1,000 · OTG+1병 1,000 · 추가송장 300 · 소분포장 없음' },
      { d: '2026-10-03', t: '셀시어스: 송장당 1,000원' },
      { d: '2026-10-03', t: '작업비정산서 = 작업상세 요약표(완박스 300 · 소분포장 300 · 합포 1,000 · 합포 1,500), 피벗 안 씀' },
      { d: '2026-10-03', t: '보관비: 그 달 일수 · 단가 (17500×1.1)/일수 · 입고·파렛트출고 = 화물 입출고 엑셀의 곡물도감/셀시어스/오리진케어 행' },
      { d: '2026-10-03', t: '보관비 시작(전월이관) = 창고관리 전달 말일 재고 + 부자재(곡물 +20 · 셀시어스 +6 · 당쉼 +10), 마감 = 그달 말 재고조사 + 부자재' },
      { d: '2026-10-03', t: '택배 파렛트 = 시작 + 입고 − 파렛트출고 − 마감 을 그날 우체국 송장 건수 비례로 나눔 (끝수 큰 나머지 순)' },
      { d: '2026-10-03', t: '기타작업내역 = 0930 형식 Sheet1, 작업금액 = 박스수 × 작업비(단가) × 1.1 · 원본에 없는 별도 출고 줄은 대표님이 추가' },
      { d: '2026-10-03', t: '청구내역서 재고보관비 = 곡·셀·오 보관비 합계 줄 (8월 파일은 셀시어스가 8/31 하루치를 가리켰음)' },
      { d: '2026-10-03', t: '착불·기타비용 = 대표님 메모 (건수 × 건당 × 1.1)' },
      { d: '2026-10-03', t: '착불 시트에 이벗 전체주문목록 고객사 메이크창고 · 판매처 로켓쉽먼트_다이렉트 · 상품명 그래놀라 송장을 송장별 한 줄(날짜=등록일, 건수 1)로 추가 — 비용은 수량 따라 달라 대표님이 엑셀에서 직접 입력(노란 칸)' },
      { d: '2026-10-03', t: '엑셀 디자인: 글꼴 맑은 고딕 10, 제목줄 남색·흰 글씨, 합계줄 연한 남색·굵게, 연회색 테두리, 눈금선 끔, 숫자 천 단위 쉼표(번호류 제외), 열 너비 맞춤, 제목줄 고정·필터, 시트 탭 색(곡 초록·셀 주황·오 보라·청구 남색·점검 빨강) — 청구내역서·작업비정산서 양식은 그대로' },
      { d: '2026-10-03', t: '로켓쉽먼트 조건을 그래놀라 → 포인트나인 상품 전체(당쉼·서리태 등)로 넓힘 (9월 당쉼 혈당컷 40개 송장 누락 발견)' },
      { d: '2026-10-03', t: '번개배송(Q10 일본 등) = 송장당 출고비 1,500 × 1.1, 착불·기타비용 시트에 송장별 한 줄' },
      { d: '2026-10-03', t: '셀·오 보관비 품명 = 그날 화물 입출고 내용(메모 + 파렛트 수, 없으면 박스) 「올리브영 발송 1 / 울산화물발송 4」 형식' },
      { d: '2026-10-03', t: '메이크창고 판매처 누락재발송(누락·교환·오배송 재발송) = 우리 실수라 미청구 원칙 — 로켓쉽먼트만 청구' },
      { d: '2026-10-03', t: '기타작업내역 원본 두 형식 자동 판별(작업비 열 = 박스수×작업비 / 작업수량·작업단가 열 = 작업수량×작업단가) · 원본 맨 아래 합계 줄 제외 · 화물 입출고는 그 달 기록만 — 1~8월 백테스트로 찾은 버그' },
      { d: '2026-10-03', t: '기타출고비(기타작업내역 작업금액)는 항상 ×1.1 — 3·5·7월은 빠져 있었음(합 549,830원 덜 받음)' },
      { d: '2026-10-03', t: '반품 양품화 = 입출고 화물관리 「반품 양품화」 기록의 박스 수 × 1,000 × 1.1, 착불·기타비용 시트에 건별 한 줄 (박스 수 빈칸이면 노란 칸)' },
      { d: '2026-10-03', t: '확인할 곳은 노란색 + 메모, 맨 뒤 「점검(확정 전 삭제)」 시트에 목록' }
    ],
    afterBuild: function(wb, ctx){
      var YM = ctx.YM, log = ctx.log, st = ctx.st, won = ctx.won, MC = MONTHS[YM];
      var Y = +YM.slice(0, 4), M = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, M, 0)).getUTCDate();
      var serial = function(d){ return Math.round(Date.UTC(Y, M - 1, d) / 864e5) + 25569; }, S0 = serial(1);
      var CHK = [];
      unshare(wb);
      /* 확인할 곳은 칸에 메모를 달지 않고 맨 뒤 「점검」 시트 목록에만 (대표님 요청 2026-10-03) */
      var mark = function(ws, a, note, list){ if (list !== false) CHK.push([ws.name, a, note]); };
      if (!MC){ log.push(['확인 필요', YM + ' 시작·마감 파렛트(창고관리)와 착불 메모가 아직 없습니다 — 대화창에서 알려 주시면 넣습니다. 지난달 값으로 둡니다']); return; }
      var box = ctx.BOX || {}, ids = Object.keys(box);
      var rows = ids.filter(function(id){ return box[id].type === 'p9_row'; });
      var etcId = ids.filter(function(id){ return box[id].type === 'coupang_po' && /포인트나인/.test(box[id].name); })[0] || ids.filter(function(id){ return box[id].type === 'coupang_po'; })[0];
      var cargoId = ids.filter(function(id){ return box[id].type === 'cargo_io'; })[0];
      if (!rows.length) log.push(['확인 필요', '파일함에 이번 달 「포인트나인크루 출고 ROW」가 없습니다']);
      if (!etcId) log.push(['확인 필요', '파일함에 0930_포인트나인크루(쿠팡 발주서 종류)가 없습니다 — 기타작업내역은 지난달 그대로']);
      if (!cargoId && !(ctx.CARGO && ctx.CARGO.length)) log.push(['확인 필요', '화물 입출고 엑셀도, 입출고 화물관리 ' + YM + ' 기록도 없습니다 — 보관비 입고·출고가 비어요']);
      var BOLT = {}, RET = [], work = {}, stor = {}, vC = 0, vD = 0, vF = 0, vG = 0;
      var rd = function(id){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]); };

      return rows.reduce(function(p, id){ return p.then(function(){ return rd(id).then(function(xwb){
        var sh = xwb.Sheets[xwb.SheetNames.filter(function(n){ return /worksheet/i.test(n); })[0] || xwb.SheetNames[0]];
        var aoa = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' }), b = brandOf(box[id], aoa);
        if (!b){ log.push(['확인 필요', box[id].name + ' — 곡물도감/셀시어스/오리진케어 중 무엇인지 모름']); return; }
        if (work[b]){ log.push(['확인 필요', BRAND[b] + ' ROW 파일이 둘 이상 — ' + box[id].name + ' 은 건너뜀']); return; }
        /* ROW데이터 */
        var rw = fresh(wb, b + '_ROW데이터'); aoa.forEach(function(r){ rw.addRow(r); }); rw.getRow(1).font = { bold: true };
        /* 작업상세 */
        var H = aoa[0].map(String), iP = H.indexOf('상품명'), iQ = H.indexOf('상품수량'), iT = H.indexOf('택배사'), iN = H.indexOf('송장번호'), iD = H.indexOf('발주일');
        var inv = {}, order = [], prods = {};
        aoa.slice(1).forEach(function(r){
          /* 번개배송(Q10 일본 등) = 송장당 출고비 1,500 → 착불·기타비용 시트 (대표님 2026-10-03) */
          if (r[iT] === '번개배송' && r[iN]){ var bk = String(r[iN]).trim(); if (!BOLT[bk]){ BOLT[bk] = { d: toSerial(r[iD]), it: [] }; } BOLT[bk].it.push(String(r[iP]).replace(/\s*\[.*$/, '') + ' ' + (r[iQ] || '')); return; }
          if (r[iT] !== '우체국택배' || !r[iN] || !r[iP]) return;
          var k = String(r[iN]); if (!inv[k]){ inv[k] = { d: toSerial(r[iD]), q: {} }; order.push(k); }
          inv[k].q[r[iP]] = (inv[k].q[r[iP]] || 0) + (+r[iQ] || 0); prods[r[iP]] = 1; });
        var ord = function(n){ return /추가송장/.test(n) ? 9 : /(15|30|45|60)입/.test(n) ? 1 : /^1병/.test(n) ? 2 : /^[SCA] /.test(n) ? 3 : /^Granola/.test(n) ? 4 : /^Pack/.test(n) ? 5 : 2; };
        var cols = Object.keys(prods).sort(function(a, c){ return ord(a) - ord(c) || a.localeCompare(c, 'ko'); });
        var fH = ['송장번호'].concat(cols);
        var ws = fresh(wb, b + '_작업상세');
        ws.addRow(['송장번호', '발주일'].concat(cols, ['박스수', '포장구분', '포장비', '소분포장']));
        ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
        var cnt = {}, rare = {}, pre = 0, days = {};
        order.forEach(function(k){ var v = inv[k], row = [k].concat(cols.map(function(c){ return v.q[c] || ''; }));
          var x = b === '곡' ? gokFee(fH, row) : b === '오' ? oriFee(fH, row) : { fee: 1000, pre: 0, kind: '송장당', box: '' };
          cnt[x.fee] = (cnt[x.fee] || 0) + 1; pre += x.pre || 0; days[v.d] = (days[v.d] || 0) + 1;
          var r2 = ws.addRow([k, v.d].concat(cols.map(function(c){ return v.q[c] || null; }), [x.box === '' || x.box == null ? null : x.box, x.kind, x.fee, x.pre || null]));
          if (/같은상품|추가송장|빈줄|기타섞임/.test(x.kind) || (+x.box || 0) >= 8){ r2.getCell(cols.length + 4).fill = YEL; rare[x.kind] = (rare[x.kind] || 0) + 1; } });
        var n = order.length, L = 2 + cols.length, cFee = L + 3, cPre = L + 4, SC = cPre + 2;
        ws.getColumn(2).numFmt = 'm"월" d"일"'; ws.getColumn(1).width = 16; for (var c = 3; c <= L; c++) ws.getColumn(c).width = 9; ws.getColumn(L + 2).width = 14;
        var col = function(c){ return ws.getColumn(c).letter; }, sc = col(SC), sd = col(SC + 1), se = col(SC + 2), sf = col(SC + 3), feeL = col(cFee), preL = col(cPre), last = n + 1;
        var tiers = b === '셀' ? [1000] : [300, 1000, 1500];
        [['포장비 구분', '건수', '단가', '금액']].forEach(function(h){ ws.getCell(sc + 1).value = h[0]; ws.getCell(sd + 1).value = h[1]; ws.getCell(se + 1).value = h[2]; ws.getCell(sf + 1).value = h[3]; });
        tiers.forEach(function(t, i){ var r = 2 + i;
          ws.getCell(sc + r).value = t === 300 ? '완박스(송장만)' : t === 1000 ? '합포 기본' : '합포 3박스↑·내품4↑';
          ws.getCell(sd + r).value = { formula: 'COUNTIF(' + feeL + '2:' + feeL + last + ',' + t + ')', result: cnt[t] || 0 };
          ws.getCell(se + r).value = t; ws.getCell(sf + r).value = { formula: sd + r + '*' + se + r, result: (cnt[t] || 0) * t }; });
        var rP = 2 + tiers.length, rT = rP + 1, tot = tiers.reduce(function(s, t){ return s + (cnt[t] || 0) * t; }, 0) + pre * 300;
        ws.getCell(sc + rP).value = '소분포장(선작업)'; ws.getCell(sd + rP).value = { formula: 'SUM(' + preL + '2:' + preL + last + ')', result: pre }; ws.getCell(se + rP).value = 300; ws.getCell(sf + rP).value = { formula: sd + rP + '*' + se + rP, result: pre * 300 };
        ws.getCell(sc + rT).value = '합계(VAT 별도)'; ws.getCell(sf + rT).value = { formula: 'SUM(' + sf + '2:' + sf + rP + ')', result: tot };
        for (var r = 1; r <= rT; r++) [sc, sd, se, sf].forEach(function(cc){ var cl = ws.getCell(cc + r); cl.border = BOX4; if (r === 1 || r === rT) cl.font = { bold: true }; if (cc !== sc) cl.numFmt = '#,##0'; });
        ws.getColumn(SC).width = 18; ws.getColumn(SC + 3).width = 13; ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
        var rk = Object.keys(rare);
        mark(ws, sc + 1, b === '셀' ? '셀시어스는 송장당 1,000원' : '새 포장 기준(2026-10-03): 완박스 300 · 합포 1~2박스 1,000 · 3박스↑/S팩 합포/60입 단독 1,500, 소분포장은 개수×300 따로' + (rk.length ? ' / 노란 포장구분 = 드문 경우: ' + rk.map(function(k){ return k + ' ' + rare[k] + '건'; }).join(', ') : ''));
        work[b] = { n: n, cnt: cnt, pre: pre, tot: tot, days: days, tiers: tiers, ref: function(t){ return b + '_작업상세!' + sd + (2 + tiers.indexOf(t)); }, refPre: b + '_작업상세!' + sd + rP };
        log.push(['자동 적용', b + '_작업상세 송장 ' + n + '건 · ' + tiers.map(function(t){ return t + '원 ' + (cnt[t] || 0) + '건'; }).join(' · ') + ' · 소분포장 ' + pre + '건 → ' + won(tot) + '원']);
      }); }); }, Promise.resolve()).then(function(){
        /* 작업비정산서 */
        var js = wb.getWorksheet('작업비정산서'), has = function(b){ return !!work[b]; };
        if (!has('곡') || !has('오') || !has('셀')){ log.push(['확인 필요', '곡·셀·오 출고 ROW 가 다 있어야 작업비정산서를 바꿉니다 — 지난달 그대로']); return; }
        var sumRef = function(t){ return ['곡', '셀', '오'].filter(function(b){ return work[b].tiers.indexOf(t) >= 0; }).map(function(b){ return work[b].ref(t); }).join('+'); };
        vC = (work.곡.cnt[300] || 0) + (work.오.cnt[300] || 0); vD = work.곡.pre + work.오.pre;
        vF = (work.곡.cnt[1000] || 0) + (work.셀.cnt[1000] || 0) + (work.오.cnt[1000] || 0); vG = (work.곡.cnt[1500] || 0) + (work.오.cnt[1500] || 0);
        js.getCell('C3').value = Y + '.' + String(M).padStart(2, '0') + '.' + ND + '.';
        js.getCell('A14').value = YM + '-01 ~ ' + YM + '-' + ND;
        [['C12', '포장비'], ['D12', '선작업'], ['E12', '-'], ['F12', '합포장'], ['G12', '합포장'], ['C13', '완박스(송장만)'], ['D13', '소분포장'], ['E13', '-'], ['F13', '합포 기본'], ['G13', '합포 3박스↑'],
         ['A17', '완박스(송장만)'], ['D17', 300], ['A18', '소분포장(선작업)'], ['D18', 300], ['A19', '-'], ['D19', 0], ['A20', '합포 기본'], ['D20', 1000], ['A21', '합포 3박스↑·내품4↑'], ['D21', 1500]].forEach(function(x){ js.getCell(x[0]).value = x[1]; });
        js.getCell('C14').value = { formula: sumRef(300), result: vC }; js.getCell('D14').value = { formula: work.곡.refPre + '+' + work.오.refPre, result: vD };
        js.getCell('E14').value = 0; js.getCell('F14').value = { formula: sumRef(1000), result: vF }; js.getCell('G14').value = { formula: sumRef(1500), result: vG };
        ['C14', 'D14', 'E14', 'F14', 'G14'].forEach(function(a){ js.getCell(a).fill = NOFILL; });
        var h = [vC * 300, vD * 300, 0, vF * 1000, vG * 1500], H22 = h.reduce(function(a, x){ return a + x; }, 0);
        var setR = function(ws, a, v){ var c = ws.getCell(a); c.value = c.value && c.value.formula ? { formula: c.value.formula, result: v } : v; };
        [['F17', vC], ['F18', vD], ['F19', 0], ['F20', vF], ['F21', vG], ['H17', h[0]], ['H18', h[1]], ['H19', 0], ['H20', h[3]], ['H21', h[4]], ['H14', vC + vD + vF + vG], ['H22', H22], ['C10', H22], ['G10', H22 * 0.1], ['C9', H22 * 1.1]].forEach(function(x){ setR(js, x[0], x[1]); });
        log.push(['자동 적용', '작업비정산서 완박스 ' + vC + ' · 소분포장 ' + vD + ' · 합포 1,000 ' + vF + ' · 합포 1,500 ' + vG + ' → 작업비 ' + won(H22) + ' (VAT 포함 ' + won(H22 * 1.1) + ')']);
        work._H22 = H22;
      }).then(function(){
        /* 기타작업내역 */
        if (!etcId) return;
        return rd(etcId).then(function(xb){
          /* 원본 줄 그대로(빈 줄 포함 — 병합 위치가 맞도록), 비고 = 원본 Q열 별도 메모만 (유통기한·재고차감 표시는 안 씀) */
          var sh = xb.Sheets['Sheet1'] || xb.Sheets[xb.SheetNames[0]];
          var a = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', blankrows: true, range: 0 });
          var lastI = a.length - 1; while (lastI > 0 && !a[lastI].some(function(v){ return v !== ''; })) lastI--;
          /* 원본 형식이 달마다 둘: ① 「작업비」 열(P) = 단가, 수량 = 박스수(L) (4·9월)  ② N 작업수량·O 작업단가·P 작업금액 (5·7·8월) — 머리글로 판별 */
          var hd = (a[0] || []).map(function(h){ return String(h).replace(/\s/g, ''); }), fmtB = hd[14] === '작업단가' || hd[15] === '작업금액';
          if (fmtB) log.push(['안내', '기타작업내역 원본 = 작업수량·작업단가 형식 (수량 N열 × 단가 O열 × 1.1)']);
          var ws = fresh(wb, '기타작업내역');
          ws.addRow(['발주번호', '발주유형', '발주현황', 'SKU ID', 'SKU 이름', 'SKU Barcode', '물류센터', '입고예정일', '발주일', '발주수량', '확정수량', '박스수', '파렛트수', '작업수량', '작업단가', '작업금액', '비고']);
          var sumM = 0, sumP = 0, n = 0, big = [];
          for (var i = 1; i <= lastI; i++){ var r = a[i] || [], R = i + 1;
            if (!r.some(function(v){ return v !== ''; })){ ws.addRow([]); continue; }
            if (i === lastI && !r.slice(0, 12).some(function(v){ return v !== ''; })) break;   /* 원본 맨 아래 합계 줄(파렛트·금액 합)은 빼고 — 엔진이 합계 줄을 따로 만듦 */
            n++;
            var unit = +(fmtB ? r[14] : r[15]) || 0, qty = unit ? (+(fmtB ? r[13] : r[11]) || 0) : 0;
            ws.addRow([r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12] === '' ? null : r[12], qty || null, unit || null, { formula: 'N' + R + '*O' + R + '*1.1', result: qty * unit * 1.1 }, r[16] || null]);
            if (typeof r[7] === 'number') ws.getCell('H' + R).numFmt = 'm"월" d"일"';
            if (typeof r[8] === 'number') ws.getCell('I' + R).numFmt = 'yyyy-mm-dd hh:mm';
            sumM += +r[12] || 0; sumP += qty * unit * 1.1;
            if (qty * unit >= 100000 || (unit && unit !== 300)){ ws.getCell('P' + R).fill = YEL; big.push(r[0] + ' ' + r[4] + ' ' + qty + '×' + unit); } }
          /* 원본 병합(파렛트수 등) 그대로 */
          (sh['!merges'] || []).forEach(function(m){ if (m.e.r <= lastI && m.s.r >= 1) try { ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1); ws.getCell(m.s.r + 1, m.s.c + 1).alignment = { vertical: 'middle', horizontal: 'center' }; } catch (e) {} });
          var F = ws.rowCount + 1;
          ws.getCell('A' + F).value = '합계'; ws.getCell('M' + F).value = { formula: 'SUM(M2:M' + (F - 1) + ')', result: sumM }; ws.getCell('P' + F).value = { formula: 'SUM(P2:P' + (F - 1) + ')', result: sumP };
          ws.getRow(F).font = { bold: true }; ws.getColumn('P').numFmt = '#,##0'; ws.getColumn('O').numFmt = '#,##0';
          [14, 8, 8, 12, 46, 16, 16, 11, 16, 9, 9, 8, 9, 9, 9, 12, 24].forEach(function(w, i){ ws.getColumn(i + 1).width = w; });
          mark(ws, 'N1', '작업수량 = 박스수, 작업단가 = 원본 「작업비」 열, 작업금액 = 수량×단가×1.1 (0930 형식)');
          mark(ws, 'A' + F, '원본에 없는 별도 출고는 이 위에 줄을 추가 — 합계 수식 범위 안에');
          if (big.length) mark(ws, 'P1', '노란 작업금액 = 10만원↑ 또는 단가가 300이 아닌 줄 ' + big.length + '줄: ' + big.slice(0, 8).join(' · ') + (big.length > 8 ? ' …' : ''));
          st.getCell('F23').value = { formula: '기타작업내역!M' + F, result: sumM }; st.getCell('F25').value = { formula: '기타작업내역!P' + F, result: sumP };
          work._M = sumM; work._P = sumP;
          log.push(['자동 적용', '기타작업내역 ' + n + '줄 · 파렛트 ' + sumM + ' · 기타출고비 ' + won(sumP)]);
        });
      }).then(function(){
        /* 보관비 */
        if (!work.곡 || !work.셀 || !work.오) return;
        return (cargoId ? rd(cargoId) : Promise.resolve(null)).then(function(cb){
          var ca = cb ? XLSX.utils.sheet_to_json(cb.Sheets['입출고내역'] || cb.Sheets[cb.SheetNames[0]], { header: 1, defval: '' }) : [];
          /* 엑셀이 없으면 입출고 화물관리 기록 → 같은 모양 [날짜시리얼, 입고/출고, 업체, 박스, 파렛트, , , 메모] (택배출고 parcel 은 택배 파렛트라 제외) */
          if (!cb && ctx.CARGO){ var skip = 0;
            ctx.CARGO.forEach(function(x){ if (!x || !x.date) return; var k = x.kind === 'in' ? '입고' : x.kind === 'out' ? '출고' : null; if (!k){ if (/곡물|셀시어스|오리진|당쉼|포인트/.test(x.vendor || '')) skip++; return; }
              var d = Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569, p = (+x.aj || 0) + (+x.etc || 0);
              String(x.vendor || '').split(',').forEach(function(v){ v = v.trim(); var nm = /곡물/.test(v) ? '곡물도감' : /셀시어스/.test(v) ? '셀시어스' : /오리진|당쉼/.test(v) ? '오리진케어' : v; ca.push([d, k, nm, x.box || '', p, '', '', x.memo || x.note || '']); }); });
            log.push(['안내', '보관비 입고·출고 = 입출고 화물관리 ' + YM + ' 기록 (화물 입출고 엑셀이 파일함에 없음)' + (skip ? ' · 택배출고·기타 ' + skip + '건은 제외' : '')]); }
          else if (cb) log.push(['안내', '보관비 입고·출고 = 파일함 화물 입출고 엑셀']);
          /* 반품 양품화 = 박스당 1,000 × 1.1 → 착불·기타비용 시트 (대표님 2026-10-03) — 화물관리 기록(kind ret), 없으면 엑셀의 「반품」 줄 */
          var p9v = function(v){ return /곡물/.test(v) ? '곡물도감' : /셀시어스/.test(v) ? '셀시어스' : /오리진|당쉼/.test(v) ? '오리진케어' : /포인트/.test(v) ? '포인트나인크루' : null; };
          if (ctx.CARGO) ctx.CARGO.forEach(function(x){ if (!x || x.kind !== 'ret' || !x.date) return; var nm = p9v(String(x.vendor || '')); if (!nm) return;
            var d = Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569; if (d >= S0 && d < S0 + ND) RET.push({ d: d, nm: nm, box: +x.box || 0, memo: x.memo || x.note || '' }); });
          else ca.forEach(function(r){ if (typeof r[0] !== 'number' || !/반품/.test(r[1])) return; var nm = p9v(String(r[2] || '')), d = Math.floor(r[0]); if (!nm || d < S0 || d >= S0 + ND) return;
            RET.push({ d: d, nm: nm, box: +r[3] || 0, memo: r[7] || '' }); });
          var LAY = { 곡: { start: 'D6', I: 'D', E: 'E', O: 'F', cost: 'G', cur: 'H', unit: 'I', sum: 'J' }, 셀: { start: 'C6', I: 'C', E: 'D', O: 'E', cost: 'F', cur: 'G', unit: 'H', sum: 'I' }, 오: { start: 'C6', I: 'C', E: 'D', O: 'E', cost: 'F', cur: 'G', unit: 'H', sum: 'I' } };
          ['곡', '셀', '오'].forEach(function(b){
            var ws = wb.getWorksheet(b + '_보관비'), L = LAY[b], name = BRAND[b]; if (!ws) return;
            ws.getCell('A1').value = Y + '.' + String(M).padStart(2, '0') + ' 파렛 수량';
            var cin = {}, cout = {}, list = [], desc = {};   /* desc = 그날 품명(입출고 내용) — 8월처럼 「올리브영 발송 1 / 울산화물발송 4」 */
            ca.forEach(function(r){ if (typeof r[0] !== 'number' || r[2] !== name) return; var d = Math.floor(r[0]);
              if (d < S0 || d >= S0 + ND) return;   /* 그 달 기록만 (엑셀에 앞뒤 달이 섞여 있어도) */
              if (r[1] !== '입고' && r[1] !== '출고') return;   /* 반품 양품화 등은 파렛트 입출고 아님 */
              if (r[1] === '입고') cin[d] = (cin[d] || 0) + (+r[4] || 0); else cout[d] = (cout[d] || 0) + (+r[4] || 0);
              var memo = String(r[7] || '').trim() || (r[1] === '입고' ? '입고' : '출고'), q = +r[4] ? ' ' + (+r[4]) : +r[3] ? ' ' + (+r[3]) + '박스' : '';
              (desc[d] = desc[d] || []).push(memo + q);
              list.push([r[1], M + '월' + (d - S0 + 1) + '일', r[7] || '', r[4] === '' ? null : +r[4], r[3] === '' ? null : +r[3]]); });
            var sum = function(o){ return Object.keys(o).reduce(function(s, k){ return s + o[k]; }, 0); }, sI = sum(cin), sO = sum(cout);
            var need = MC.start[b] + sI - sO - MC.end[b];
            var wd = [], wt = 0; for (var d = 1; d <= ND; d++){ var v = work[b].days[serial(d)] || 0; wd.push(v); wt += v; }
            var tk = wd.map(function(v){ return wt ? need * v / wt : 0; }), fl = tk.map(function(v){ return Math.floor(Math.max(0, v)); });
            var rem = Math.max(0, need) - fl.reduce(function(s, v){ return s + v; }, 0);
            tk.map(function(v, i){ return [v - Math.floor(v), i]; }).sort(function(x, y){ return y[0] - x[0]; }).forEach(function(x){ if (rem > 0 && wd[x[1]]){ fl[x[1]]++; rem--; } });
            var first = 7, lastR = 6 + ND, sumR = lastR + 1, unit = 17500 * 1.1 / ND, cur = MC.start[b], T = { I: 0, E: 0, O: 0, S: 0 };
            ws.getCell(L.start).value = MC.start[b]; ws.getCell('B6').value = '전월이관 (창고관리 전달 말일 + 부자재 ' + ADJ[b] + ')';
            for (var i = 0; i < ND; i++){
              var r = first + i, dd = serial(i + 1), row = ws.getRow(r);
              cur += (cin[dd] || 0) - fl[i] - (cout[dd] || 0); T.I += cin[dd] || 0; T.E += fl[i]; T.O += cout[dd] || 0; T.S += cur * unit;
              row.getCell('A').value = dd; row.getCell('A').numFmt = 'm"월" d"일"';
              if (b === '곡'){ row.getCell('B').value = i === 0 ? '상세내역 우측 셀참조' : null; row.getCell('C').value = null; } else row.getCell('B').value = desc[dd] ? desc[dd].join(' / ') : null;
              ws.getCell(L.I + r).value = cin[dd] || null; ws.getCell(L.E + r).value = fl[i] || null; ws.getCell(L.O + r).value = cout[dd] || null; ws.getCell(L.cost + r).value = 3000;
              ws.getCell(L.cur + r).value = { formula: (i === 0 ? L.start : L.cur + (r - 1)) + '+' + L.I + r + '-' + L.E + r + '-' + L.O + r, result: cur };
              ws.getCell(L.unit + r).value = { formula: '(17500*1.1)/' + ND, result: unit };
              ws.getCell(L.sum + r).value = { formula: 'PRODUCT(' + L.cur + r + ':' + L.unit + r + ')', result: cur * unit };
            }
            for (var rr = sumR; rr <= sumR + 3; rr++) for (var cc = 1; cc <= 10; cc++){ var cl = ws.getRow(rr).getCell(cc); cl.value = null; cl.fill = NOFILL; }
            ws.getCell('A' + sumR).value = '합계';
            [[L.I, T.I], [L.E, T.E], [L.O, T.O]].forEach(function(x){ ws.getCell(x[0] + sumR).value = { formula: 'SUM(' + x[0] + first + ':' + x[0] + lastR + ')', result: x[1] }; });
            ws.getCell(L.sum + sumR).value = { formula: 'SUM(' + L.sum + first + ':' + L.sum + lastR + ')', result: T.S };
            ws.getRow(sumR).font = { bold: true }; ws.getCell('A' + (sumR + 1)).value = '* 입출고 비용 / 파레트별 입고 & 출고 비용 ';
            if (b === '곡'){ for (var r3 = 2; r3 <= Math.max(ws.rowCount, 80); r3++) ['L', 'M', 'N', 'O', 'P'].forEach(function(c){ ws.getCell(c + r3).value = null; });
              list.forEach(function(x, i){ ['L', 'M', 'N', 'O', 'P'].forEach(function(c, j){ ws.getCell(c + (2 + i)).value = x[j]; }); }); }
            mark(ws, L.start, '시작 = 창고관리 전달 말일 + 부자재 ' + ADJ[b] + ' (대화창에서 받은 값)');
            mark(ws, L.cur + lastR, '마감 = 재고조사 + 부자재 = ' + MC.end[b] + ' 에 맞춤' + (cur !== MC.end[b] ? ' ⚠ 실제 ' + cur : ''));
            mark(ws, L.E + 5, '택배 파렛트 ' + need + '팔 = 시작+입고−파렛트출고−마감, 우체국 송장 건수 비례' + (need < 0 ? ' ⚠ 음수 — 시작·마감 값 확인' : ''));
            stor[b] = { sumR: sumR, money: T.S, sI: T.I, sO: T.O };
            log.push([need < 0 ? '확인 필요' : '자동 적용', b + '_보관비 시작 ' + MC.start[b] + ' + 입고 ' + T.I + ' − 파렛트출고 ' + T.O + ' − 택배 ' + T.E + ' = ' + cur + ' (마감 ' + MC.end[b] + ') · 보관비 ' + won(T.S)]);
          });
          st.getCell('G6').value = { formula: 'SUM(곡_보관비!J' + stor.곡.sumR + '+셀_보관비!I' + stor.셀.sumR + '+오_보관비!I' + stor.오.sumR + ')', result: stor.곡.money + stor.셀.money + stor.오.money };
          st.getCell('F27').value = { formula: 'SUM(곡_보관비!D' + stor.곡.sumR + ',곡_보관비!F' + stor.곡.sumR + ',셀_보관비!C' + stor.셀.sumR + ',셀_보관비!E' + stor.셀.sumR + ',오_보관비!C' + stor.오.sumR + ',오_보관비!E' + stor.오.sumR + ')',
            result: stor.곡.sI + stor.곡.sO + stor.셀.sI + stor.셀.sO + stor.오.sI + stor.오.sO };
          work._stor = stor;
        });
      }).then(function(){
        /* 착불·기타비용 = 대표님 메모 + 이벗 주문목록 로켓쉽먼트 포인트나인 상품 송장 + 번개배송 출고비 (비용은 대표님이 엑셀에서 직접) */
        var ws = wb.getWorksheet('택배착불및기타비용'); if (!ws) return;
        var eb = ids.filter(function(id){ return box[id].type === 'ebut_orders'; });
        if (!eb.length) log.push(['확인 필요', '파일함에 이벗 전체주문목록이 없습니다 — 로켓쉽먼트 송장을 착불 시트에 못 넣었어요']);
        var rk = {}, rkOrd = [];
        return eb.reduce(function(p, id){ return p.then(function(){ return rd(id).then(function(xwb){
          var a = XLSX.utils.sheet_to_json(xwb.Sheets[xwb.SheetNames[0]], { header: 1, defval: '' }), H = (a[0] || []).map(function(h){ return String(h).replace(/\s/g, ''); });
          var c = function(n){ return H.indexOf(n); }, iC = c('고객사'), iS = c('판매처'), iP = c('상품명'), iQ = c('수량'), iN = c('송장번호'), iD = c('등록일'), iR = c('수령자');
          if (iS < 0 || iN < 0) return;
          a.slice(1).forEach(function(r){
            /* 포인트나인 상품 전체(곡물도감·그래놀라·당쉼·오리진케어·셀시어스…) — 2026-10-03 그래놀라만 → 전체로 넓힘 */
            if (String(r[iC]).trim() !== '메이크창고' || !/^로켓쉽먼트_다이렉트/.test(String(r[iS]).trim()) || !P9_ITEM.test(r[iP]) || !r[iN]) return;
            var k = String(r[iN]).trim(), pn = String(r[iP]), g = pn.match(/그래놀라\s*([^\s(]+)/);
            var nm = g ? '그래놀라 ' + g[1] : pn.replace(/^곡물도감\s*/, '').split(/[,(]/)[0].slice(0, 22).trim();
            if (!rk[k]){ rk[k] = { d: String(r[iD]).slice(0, 10), to: r[iR], it: [] }; rkOrd.push(k); }
            rk[k].it.push(nm + ' ' + r[iQ]); });
        }); }); }, Promise.resolve()).then(function(){
          for (var r = 2; r <= Math.max(ws.rowCount, 40); r++) ['A', 'B', 'C', 'D', 'E'].forEach(function(c){ ws.getCell(c + r).value = null; ws.getCell(c + r).fill = NOFILL; });
          var tot = 0, n = 0;
          (MC.cod || []).forEach(function(x){ var r = 2 + n++, v = x[2] * x[3] * 1.1; tot += v;
            ws.getCell('A' + r).value = serial(x[0]); ws.getCell('A' + r).numFmt = 'm"월" d"일"'; ws.getCell('B' + r).value = x[1]; ws.getCell('C' + r).value = x[2]; ws.getCell('D' + r).value = x[3];
            ws.getCell('E' + r).value = { formula: 'C' + r + '*D' + r + '*1.1', result: v }; });
          rkOrd.sort(function(x, y){ return rk[x].d.localeCompare(rk[y].d) || x.localeCompare(y); }).forEach(function(k){ var x = rk[k], r = 2 + n++, dd = x.d.split('-');
            ws.getCell('A' + r).value = dd.length === 3 ? Math.round(Date.UTC(+dd[0], +dd[1] - 1, +dd[2]) / 864e5) + 25569 : x.d; ws.getCell('A' + r).numFmt = 'm"월" d"일"';
            ws.getCell('B' + r).value = '로켓쉽먼트 ' + x.to + ' · ' + x.it.join(', ') + ' · 송장 ' + k; ws.getCell('C' + r).value = 1;
            ws.getCell('D' + r).fill = YEL; ws.getCell('E' + r).value = { formula: 'C' + r + '*D' + r + '*1.1', result: 0 }; });
          if (rkOrd.length){ mark(ws, 'D' + (2 + (MC.cod || []).length) + ':D' + (1 + n), '로켓쉽먼트 ' + rkOrd.length + '건 — 비용(노란 칸)은 수량 따라 대표님이 직접 입력');
            log.push(['확인 필요', '착불 시트에 로켓쉽먼트 송장 ' + rkOrd.length + '건 — 비용 칸(노란색)은 직접 입력해 주세요']); }
          var bo = Object.keys(BOLT).sort(function(x, y){ return (BOLT[x].d || 0) - (BOLT[y].d || 0) || x.localeCompare(y); });
          bo.forEach(function(k){ var x = BOLT[k], r = 2 + n++, v = 1500 * 1.1; tot += v;
            ws.getCell('A' + r).value = x.d; ws.getCell('A' + r).numFmt = 'm"월" d"일"';
            ws.getCell('B' + r).value = '번개배송 출고비 · ' + x.it.join(', ') + ' · 송장 ' + k; ws.getCell('C' + r).value = 1; ws.getCell('D' + r).value = 1500;
            ws.getCell('E' + r).value = { formula: 'C' + r + '*D' + r + '*1.1', result: v }; });
          if (bo.length) log.push(['자동 적용', '번개배송 출고비 ' + bo.length + '건 × 1,500 × 1.1 = ' + won(bo.length * 1650)]);
          var rb = 0;
          RET.sort(function(x, y){ return x.d - y.d; }).forEach(function(x){ var r = 2 + n++, v = x.box * 1000 * 1.1; tot += v; rb += x.box;
            ws.getCell('A' + r).value = x.d; ws.getCell('A' + r).numFmt = 'm"월" d"일"';
            ws.getCell('B' + r).value = x.nm + ' 반품양품화 ' + x.box + '박스' + (x.memo ? ' · ' + x.memo : ''); ws.getCell('C' + r).value = x.box; ws.getCell('D' + r).value = 1000;
            ws.getCell('E' + r).value = { formula: 'C' + r + '*D' + r + '*1.1', result: v };
            if (!x.box){ ws.getCell('C' + r).fill = YEL; mark(ws, 'C' + r, '반품 양품화 박스 수가 기록에 없음 — 직접 입력'); } });
          log.push(['자동 적용', RET.length ? '반품 양품화 ' + RET.length + '건 · ' + rb + '박스 × 1,000 × 1.1 = ' + won(rb * 1100) : '반품 양품화 기록 없음 (화물관리 「반품 양품화」로 적으면 자동 청구)']);
          var F = 2 + n;
          ws.getCell('E' + F).value = { formula: 'SUM(E2:E' + Math.max(2, F - 1) + ')', result: tot };
          st.getCell('G38').value = { formula: '택배착불및기타비용!E' + F, result: tot };
          work._cod = tot;
          log.push(['자동 적용', '착불·기타비용 ' + n + '줄 · ' + won(tot) + (rkOrd.length ? ' (로켓쉽먼트 ' + rkOrd.length + '건 비용 입력 전)' : '')]);
        });
      }).then(function(){
        /* 청구내역서 결과값·표시 */
        var setR = function(a, v){ var c = st.getCell(a); c.value = c.value && c.value.formula ? { formula: c.value.formula, result: v } : v; };
        st.getCell('B1').value = YM + ' 청구내역서';
        if (work._stor) setR('G6', work._stor.곡.money + work._stor.셀.money + work._stor.오.money);
        if (work._H22 != null) setR('G22', work._H22 * 1.1);
        if (work._M != null){ setR('G23', work._M * 11000); setR('G25', work._P); }
        if (work._stor){ var s = work._stor; setR('G27', (s.곡.sI + s.곡.sO + s.셀.sI + s.셀.sO + s.오.sI + s.오.sO) * 3300); }
        if (work._cod != null) setR('G38', work._cod);
        var sum = 0; for (var r = 6; r <= 40; r++){ var v = st.getCell('G' + r).value; sum += +(v && typeof v === 'object' ? v.result : v) || 0; }
        setR('G41', sum); setR('G42', sum / 1.1); setR('G43', sum - sum / 1.1);
        mark(st, 'G6', '보관비 = 곡·셀·오 보관비 합계 줄 (30일이면 ÷30)');
        mark(st, 'G22', '작업비 = 새 포장 기준 (작업상세 요약표 → 작업비정산서)');
        mark(st, 'F23', '파렛트수 = 기타작업내역 합계 — 별도 출고 줄 추가 시 같이 늘어남');
        mark(st, 'G38', '착불·기타비용 = 대표님 메모 + 로켓쉽먼트 그래놀라 송장(비용 직접 입력)');
        beautify(wb);
        var ck = wb.getWorksheet('점검(확정 전 삭제)'); if (ck) wb.removeWorksheet(ck.id);
        ck = wb.addWorksheet('점검(확정 전 삭제)');
        ck.columns = [{ header: '시트', width: 20 }, { header: '칸', width: 10 }, { header: '확인할 내용', width: 110 }]; styleHead(ck.getRow(1), 3); ck.getRow(1).height = 24;
        CHK.forEach(function(x){ var r = ck.addRow(x); r.getCell(1).value = { text: x[0], hyperlink: "#'" + x[0] + "'!" + x[1] }; });
        body(ck, 1, 2, ck.rowCount, 1, 3);
        for (var cr = 2; cr <= ck.rowCount; cr++){ ck.getCell('A' + cr).font = { name: '맑은 고딕', size: 10, color: { argb: 'FF1F5FBF' }, underline: true }; ck.getCell('B' + cr).alignment = A_C; ck.getCell('C' + cr).alignment = { wrapText: true, vertical: 'middle' }; }
        ck.addRow([]); var nr = ck.addRow(['', '', '노란 칸 = 드물거나 큰 금액이라 한 번 볼 곳. 확인이 끝나면 이 시트를 지우고 저장 → 정산관리 ⑤ 완료 확정에 올려 주세요.']);
        nr.getCell(3).font = { name: '맑은 고딕', size: 9, italic: true, color: { argb: 'FF7F7F7F' } };
        look(ck, 'FFC00000', [0, 1]);
        log.push(['자동 적용', '청구내역서 포함가 ' + won(sum) + ' (공급가 ' + won(sum / 1.1) + ') · 점검 표시 ' + CHK.length + '곳']);
      });
    }
  };
  E['포인트나인크루'].MONTHS = MONTHS;   /* 백테스트에서 지난 달 값(시작·마감 파렛트·착불)을 넣어 보기 위해 */
})();
