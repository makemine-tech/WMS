/* ============================================================
   정산관리 — 업체별 설정·자동 처리 (업체 룰은 여기에만 있다)

   화면에는 룰 입력 칸이 없다. 대표님이 대화창에서 요청하면 Claude 가 이 파일에 넣고,
   그 업체는 이 설정대로 고정해서 움직인다. 화면 맨 아래 '적용 룰' 목록 = ruleList.
   업체 키 = 업체명에서 .#$/[] → _ (파일함 표본 'MM월_거래내역서_업체명' 의 업체명)

   SETTLE_ENGINES[업체키] = {
     items:    { 행: 'fixed' | 'manual' | 'auto' }   📌 지난달 그대로 · ✏️ 매달 화면에서 입력 · ⚙️ 자동 계산
     sheets:   { 시트이름: 'copy' | 'skip' }          📋 이번 달 원본으로 교체 · ➖ 손대지 않음 (화물 청구서 종류 시트는 copy 면 청구서 Sheet1 로)
     verified: { 행: true }                         ✅ 지난달 원본으로 지난달 완료본 재현 → 일치 확인한 항목
     opt:      { checkSheet, noYellow }             엑셀에 점검 시트 넣기(기본 끔) · 노란 표시 끄기
     ruleList: [ { d:'반영일', t:'룰' } ]             화면 맨 아래 번호 목록 — 요청이 늘면 뒤에 추가
     afterBuild(wb, ctx)                            공통 처리(날짜·시트 교체·수량) 뒤에 업체 전용 처리
        ctx = { YM, A(표본 분석), st(거래명세표 시트), log(push [구분, 내용]), won }
   }
============================================================ */
var SETTLE_ENGINES = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};

(function(){
  'use strict';
  var THIN = { style: 'thin', color: { argb: 'FF000000' } };
  var BOX4 = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); return v == null ? '' : String(v); }
  function headMap(ws, r){ var m = {}; ws.getRow(r).eachCell(function(c, n){ var t = txt(c.value).replace(/\s+/g, ''); if (t) m[t] = n; }); return m; }
  function numOf(v){ if (v && typeof v === 'object' && 'result' in v) v = v.result; var n = Number(v); return isFinite(n) ? n : 0; }

  /* ───────── 포인트나인크루 용차비 (2026-10-02 대표님 룰) ─────────
     1. 용차비 시트 J열 = 합계금액(I)의 부가세 포함가, 값으로 기입
     2. J열 맨 아래 = 그 합계
     3. 내용 칸 전부 테두리·보기 좋게 (날짜 '○월 ○일', 금액 천 단위)
     4. 업체명 '포인트나인크루' → '포인트나인크루(곡물)'
     5. 내역서 B1 '청구내역서' 년월 → 정산월
     6. 내역서 G21 = 용차비 시트 부가세 합계 */
  SETTLE_ENGINES['포인트나인크루_용차비'] = {
    items: { 21: 'auto' },
    sheets: { '용차비': 'copy' },
    /* 8월 청구서로 8월분을 다시 만들어 실제 완료본과 대조: 120건 · 포함가 34,969,000 · 공급가 31,790,000 · 세액 3,179,000 일치 (2026-10-02) */
    verified: { 21: true },
    opt: { checkSheet: false },
    ruleList: [
      { d: '2026-10-02', t: '용차비 시트 = 그 달 화물 청구서 Sheet1(업체 청구용)의 포인트나인크루 건 전부 (괄호 안 곡물·당쉼 등 모두) — 청구서 확인 화면에서 고친 금액·지정한 업체 반영' },
      { d: '2026-10-02', t: '용차비 시트 J열 = 합계금액 × 1.1 (부가세 포함가, 값으로 기입)' },
      { d: '2026-10-02', t: 'J열 맨 아래 줄 = J열 합계 (A열에 "합계")' },
      { d: '2026-10-02', t: '용차비 시트 모든 내용 칸 테두리 · 날짜 ○월 ○일 · 금액 천 단위 쉼표' },
      { d: '2026-10-02', t: '업체명 「포인트나인크루」 → 「포인트나인크루(곡물)」' },
      { d: '2026-10-02', t: '내역서 B1 「YYYY-MM 청구내역서」 → 정산월' },
      { d: '2026-10-02', t: '내역서 G21 = 용차비 시트 J열 합계 (포함가 G25 · 공급가액 G26 · 세액 G27 까지 값 채움)' },
      { d: '2026-10-02', t: '엑셀에 점검 시트는 넣지 않음 (적용 결과는 화면에만)' }
    ],
    afterBuild: function(wb, ctx){
      var ws = wb.getWorksheet('용차비'), log = ctx.log, won = ctx.won;
      if (!ws){ log.push(['확인 필요', '용차비 시트가 없습니다']); return; }
      var H = 1, hm = headMap(ws, H);
      var cI = hm['합계금액'], cJ = hm['부가세포함'], cL = hm['업체명'], cA = hm['일자'], cG = hm['금액'], cH = hm['기타'];
      var lastCol = Math.max.apply(null, Object.keys(hm).map(function(k){ return hm[k]; }));
      /* 데이터 끝 = 업체명 또는 출발지가 있는 마지막 줄 */
      var cB = hm['출발지'], last = H;
      for (var r = H + 1; r <= ws.rowCount; r++){ var row = ws.getRow(r); if (txt(row.getCell(cB).value) || txt(row.getCell(cL).value)) last = r; }
      var total = 0, renamed = 0;
      for (var r2 = H + 1; r2 <= last; r2++){
        var rw = ws.getRow(r2);
        /* 4. 업체명 */
        var vn = txt(rw.getCell(cL).value).trim();
        if (vn === '포인트나인크루'){ rw.getCell(cL).value = '포인트나인크루(곡물)'; renamed++; }
        /* 날짜: 글자(2026-09-03)면 날짜로 */
        var dc = rw.getCell(cA), dv = dc.value;
        if (typeof dv === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dv)){ dc.value = new Date(Date.UTC(+dv.slice(0, 4), +dv.slice(5, 7) - 1, +dv.slice(8, 10))); }
        dc.numFmt = 'm"월" d"일";@';
        /* 1. J = I × 1.1 (I 가 비면 금액+기타) */
        var iv = numOf(rw.getCell(cI).value); if (!iv) iv = numOf(rw.getCell(cG).value) + numOf(rw.getCell(cH).value);
        var jv = Math.round(iv * 1.1);
        rw.getCell(cI).value = iv; rw.getCell(cJ).value = jv; total += jv;
        /* 3. 테두리·숫자 모양 */
        for (var c = 1; c <= lastCol; c++){ var cell = rw.getCell(c); cell.border = BOX4; if (!cell.font) cell.font = { name: '맑은 고딕', size: 11 }; }
        [cG, cH, cI, cJ].forEach(function(cc){ if (cc) rw.getCell(cc).numFmt = '#,##0'; });
      }
      /* 2. 맨 아래 합계 (바로 아래 줄) */
      var F = last + 1, fr = ws.getRow(F);
      for (var c2 = 1; c2 <= lastCol; c2++){ var fc = fr.getCell(c2); if (c2 !== cJ && c2 !== cA) fc.value = null; fc.border = BOX4; fc.font = { name: '맑은 고딕', size: 11, bold: true }; }
      fr.getCell(cA).value = '합계';
      fr.getCell(cJ).value = { formula: 'SUM(' + ws.getColumn(cJ).letter + (H + 1) + ':' + ws.getColumn(cJ).letter + last + ')', result: total };
      fr.getCell(cJ).numFmt = '#,##0';
      for (var r3 = F + 1; r3 <= Math.min(ws.rowCount, F + 3); r3++) ws.getRow(r3).eachCell(function(cc){ cc.value = null; });   /* 예전 합계 줄 찌꺼기 */
      /* J열(부가세포함)은 여기서 채우므로 '제목이 안 맞는 열' 경고는 지운다 */
      for (var q = log.length - 1; q >= 0; q--) if (/시트 「용차비」 — 제목이 안 맞는 열/.test(log[q][1])) log.splice(q, 1);
      log.push(['자동 적용', '용차비 시트 J열 부가세포함가 ' + (last - H) + '건 · 맨 아래 ' + F + '행 합계 ' + won(total) + '원 · 테두리·날짜·금액 모양']);
      if (renamed) log.push(['자동 적용', '업체명 포인트나인크루 → 포인트나인크루(곡물) ' + renamed + '건']);
      /* 5. 내역서 년월 */
      var ns = ctx.st, tag = ctx.YM;
      ns.eachRow(function(row){ row.eachCell(function(cell){
        if (typeof cell.value === 'string' && /청구내역서/.test(cell.value) && /\d{4}-\d{2}/.test(cell.value)){
          var o = cell.value; cell.value = cell.value.replace(/\d{4}-\d{2}/, tag); if (o !== cell.value && cell.address === 'B1') log.push(['자동 적용', '내역서 제목 ' + o + ' → ' + cell.value]); }
      }); });
      /* 6. G21 = 용차비 J 합계 + 포함가·공급가·세액 */
      var JL = ws.getColumn(cJ).letter;
      ns.getCell('G21').value = { formula: '용차비!' + JL + F, result: total };
      var sum = 0; for (var r4 = 6; r4 <= 24; r4++){ sum += numOf(ns.getCell('G' + r4).value); }
      ns.getCell('G25').value = { formula: 'SUM(G6:G24)', result: sum };
      ns.getCell('G26').value = { formula: 'G25/1.1', result: sum / 1.1 };
      ns.getCell('G27').value = { formula: 'G25-G26', result: sum - sum / 1.1 };
      log.push(['자동 적용', '내역서 G21 = 용차비!' + JL + F + ' = ' + won(total) + '원 · 포함가 ' + won(sum) + ' · 공급가액 ' + won(sum / 1.1) + ' · 세액 ' + won(sum - sum / 1.1)]);
    }
  };
})();
