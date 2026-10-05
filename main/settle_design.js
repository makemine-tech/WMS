/* ============================================================
   정산관리 — 거래명세서 디자인 내려받기 (대표님 2026-10-05, 🗂️ 삼자물류정산관리 탭)
   완료 확정본(원본 양식)을 그대로 두고, 맨 앞에 디자인한 「거래명세서」 시트를 붙여 내려받는다.
     · 원본 거래명세표 시트는 「거래명세표(원본)」으로 이름만 바꿔 숨김 — 디자인 시트의 수량·단가·금액·세액이 그 칸을 가리킴(연산이 살아 있음)
     · 데이터 시트(배송비·반품비·입고작업…)는 그대로
     · 항목·수량 칸 위치는 표본 분석(SETTLE_STMT.analyze: 내역·수량·단가·금액·세액 열)으로 찾음 → 업체마다 양식이 달라도 됨
   SETTLE_DESIGN.list = [{ id, name, desc }] · SETTLE_DESIGN.build(bytes, id, info) → Promise<{ buf, warn[] }>
     info = { vendor(화면 이름), corp(공급받는자 상호), ym, mail, note }
============================================================ */
(function(){
  'use strict';
  var PAL = {
    d1: { name: '디자인 1 · 네이비 골드', desc: '고급 · 네이비와 골드 포인트', main: 'FF1B2A41', acc: 'FFB08D57', soft: 'FFF6F0E6', zebra: 'FFF8F9FB', band: 'FF1B2A41', bandTxt: 'FFFFFFFF', bandSub: 'FFE9D9BD', brand: 'MAKEMINE DESIGN' },
    d2: { name: '디자인 2 · 모던 블랙', desc: '미니멀 · 흑백과 가는 선', main: 'FF111111', acc: 'FF111111', soft: 'FFF3F3F3', zebra: 'FFFAFAFA', band: 'FFFFFFFF', bandTxt: 'FF111111', bandSub: 'FF6B7280', brand: 'MAKEMINE DESIGN', line: true },
    d3: { name: '디자인 3 · 포레스트 그린', desc: '차분한 · 짙은 초록과 크림', main: 'FF1F3D33', acc: 'FF6E8F5E', soft: 'FFEEF3EA', zebra: 'FFF7F9F5', band: 'FF1F3D33', bandTxt: 'FFFFFFFF', bandSub: 'FFCFE0C6', brand: 'MAKEMINE DESIGN' }
  };
  var SUP = { biz: '119-86-94602', corp: '메이크마인디자인㈜', ceo: '박 경 우', addr: '경기도 김포시 황금3로 7번길 42', type: '서비스 외 · 기타임가공, 기타도급(운수/일반창고업)', bank: 'IBK 기업은행  568-025968-04-010   예금주  메이크마인디자인㈜' };
  var INK = 'FF1F2937', GRAY = 'FF6B7280', LINE = 'FFD9DDE3', WHITE = 'FFFFFFFF';
  var F = function(c){ return { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }; };
  var font = function(o){ return Object.assign({ name: '맑은 고딕', size: 9, color: { argb: INK } }, o || {}); };
  var hair = { style: 'hair', color: { argb: LINE } };
  function colL(i){ var s = ''; i++; while (i > 0){ var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }   /* 0 → A */
  function ymLab(ym){ return ym ? ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월분' : ''; }
  function lastDay(ym){ var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function build(bytes, id, info){
    var P = PAL[id]; if (!P) return Promise.reject(new Error('디자인 없음: ' + id));
    info = info || {}; var warn = [];
    var A = SETTLE_STMT.analyze(XLSX.read(bytes, { type: 'array', cellFormula: true })), H = A.header;
    if (!H) return Promise.reject(new Error('확정본 거래명세표에서 내역·수량·금액 열을 못 찾음'));
    var wb = new ExcelJS.Workbook();
    return wb.xlsx.load(bytes).then(function(){
      if (window.fixForWrite) window.fixForWrite(wb);
      /* 피벗표는 ExcelJS 로 다시 쓰면 사라져 GETPIVOTDATA 가 #REF! → 확정본에 저장된 값으로 고정 (다른 수식은 그대로 살아 있음) */
      var nPiv = 0;
      wb.eachSheet(function(s){ s.eachRow(function(row){ row.eachCell(function(c){ var v = c.value;
        if (v && typeof v === 'object' && ((v.formula && /GETPIVOTDATA/i.test(v.formula)) || (v.sharedFormula && /GETPIVOTDATA/i.test(String(c.formula || ''))))){ c.value = v.result != null ? v.result : null; nPiv++; } }); }); });
      if (nPiv) warn.push('피벗 값 ' + nPiv + '칸은 확정본 값으로 고정 (피벗표는 디자인 파일에 안 따라옴)');
      var org = wb.getWorksheet(A.sheet) || wb.worksheets[0], ON = '거래명세표(원본)';
      org.name = ON; org.state = 'hidden';
      var REF = function(C, r){ return "'" + ON + "'!" + colL(C) + r; };
      var ws = wb.addWorksheet('거래명세서', { views: [{ showGridLines: false }],
        pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.45, bottom: 0.5, header: 0.2, footer: 0.25 } },
        headerFooter: { oddFooter: '&L&8&K6B7280' + SUP.corp + ' · 거래명세서&R&8&K6B7280&P / &N' } });
      ws.orderNo = -1; org.orderNo = 9999;
      [2, 5, 7, 30, 8, 10, 11, 14, 12, 22, 2].forEach(function(w, i){ ws.getColumn(i + 1).width = w; });
      var cell = function(a, v, o){ var c = ws.getCell(a); if (v !== undefined) c.value = v; if (o){ if (o.font) c.font = font(o.font); if (o.fill) c.fill = F(o.fill); if (o.al) c.alignment = o.al; if (o.b) c.border = o.b; if (o.nf) c.numFmt = o.nf; } return c; };
      var box = function(r1, c1, r2, c2, fill){ for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) ws.getRow(r).getCell(c).fill = F(fill); };
      var accB = { style: P.line ? 'thin' : 'medium', color: { argb: P.acc } }, mainB = { style: 'thin', color: { argb: P.main } };
      var NUM = '#,##0;-#,##0;"-"';
      /* 머리 */
      ws.getRow(1).height = 8; if (!P.line) box(2, 2, 2, 10, P.main); else for (var c0 = 2; c0 <= 10; c0++) ws.getRow(2).getCell(c0).border = { top: { style: 'medium', color: { argb: P.main } } };
      ws.getRow(2).height = 6; ws.getRow(3).height = 40;
      ws.mergeCells('B3:F3'); cell('B3', '거 래 명 세 서', { font: { size: 24, bold: true, color: { argb: P.main } }, al: { vertical: 'bottom' } });
      ws.mergeCells('G3:J3'); cell('G3', P.brand, { font: { size: 10, bold: true, color: { argb: P.acc } }, al: { horizontal: 'right', vertical: 'bottom' } });
      ws.getRow(4).height = 16; ws.mergeCells('B4:F4'); cell('B4', 'STATEMENT OF TRANSACTION', { font: { size: 8, bold: true, color: { argb: P.acc } }, al: { vertical: 'top' } });
      ws.mergeCells('G4:J4'); cell('G4', ymLab(info.ym) + '  ·  발행일 ' + info.ym.replace('-', '. ') + '. ' + lastDay(info.ym) + '.', { font: { size: 8, color: { argb: GRAY } }, al: { horizontal: 'right', vertical: 'top' } });
      for (var c1 = 2; c1 <= 10; c1++) ws.getRow(4).getCell(c1).border = { bottom: accB };
      ws.getRow(5).height = 10;
      /* 카드 */
      var hdr = function(a, t){ cell(a, t, { font: { size: 8, bold: true, color: { argb: P.line ? P.main : WHITE } }, fill: P.line ? 'FFFFFFFF' : P.main, al: { indent: 1, vertical: 'middle' }, b: P.line ? { bottom: mainB } : undefined }); };
      ws.mergeCells('B6:E6'); hdr('B6', '공급받는자  BILL TO'); ws.mergeCells('G6:J6'); hdr('G6', '공급자  FROM'); ws.getRow(6).height = 18;
      var y = +info.ym.slice(0, 4), m = info.ym.slice(5, 7), dd = lastDay(info.ym);
      var Lr = [['상    호', (info.corp || info.vendor || '') + '  貴中', true], ['정산기간', y + '. ' + m + '. 01 ~ ' + y + '. ' + m + '. ' + dd], ['구    분', info.vendor || ''], ['참조메일', info.mail || '']];
      var Rr = [['등록번호', SUP.biz], ['상    호', SUP.corp + '   대표  ' + SUP.ceo + '  (인)'], ['주    소', SUP.addr], ['업태/종목', SUP.type]];
      for (var i = 0; i < 4; i++){ var r = 7 + i; ws.getRow(r).height = 19;
        ws.mergeCells('B' + r + ':C' + r); cell('B' + r, Lr[i][0], { font: { size: 8, color: { argb: GRAY } }, fill: P.soft, al: { indent: 1, vertical: 'middle' } });
        ws.mergeCells('D' + r + ':E' + r); cell('D' + r, Lr[i][1], { font: { size: Lr[i][2] ? 11 : 9, bold: !!Lr[i][2] }, al: { vertical: 'middle', indent: 1, shrinkToFit: true } });
        cell('G' + r, Rr[i][0], { font: { size: 8, color: { argb: GRAY } }, fill: P.soft, al: { indent: 1, vertical: 'middle' } });
        ws.mergeCells('H' + r + ':J' + r); cell('H' + r, Rr[i][1], { font: { size: 9 }, al: { vertical: 'middle', indent: 1, shrinkToFit: true } });
        ['B', 'C', 'D', 'E', 'G', 'H', 'I', 'J'].forEach(function(c){ ws.getCell(c + r).border = { bottom: hair }; }); }
      ws.getRow(11).height = 12;
      /* 청구금액 띠 (12·13) — 아래에서 채움 */
      ws.getRow(12).height = 34; box(12, 2, 12, 10, P.band); if (P.line) for (var c2 = 2; c2 <= 10; c2++) ws.getRow(12).getCell(c2).border = { top: mainB, bottom: mainB };
      ws.mergeCells('B12:D12'); ws.mergeCells('E12:G12'); ws.mergeCells('H12:J12');
      ws.getRow(13).height = 18; box(13, 2, 13, 10, P.soft); ws.mergeCells('B13:J13');
      ws.getRow(14).height = 8;
      ['No', '월/일', '내    역', '규격', '수량', '단가', '공급가액', '세액', '비고'].forEach(function(h, k){ cell(colL(1 + k) + 15, h, { font: { size: 8, bold: true, color: { argb: P.main } }, al: { horizontal: k === 2 || k === 8 ? 'left' : 'center', vertical: 'middle', indent: k === 2 || k === 8 ? 1 : 0 }, b: { top: mainB, bottom: mainB } }); });
      ws.getRow(15).height = 22;
      /* 항목 */
      var r = 16, no = 0, rows = [], z = 0, first = 16;
      var section = function(t){ ws.getRow(r).height = 18; ws.mergeCells('B' + r + ':J' + r); cell('B' + r, '  ' + t, { font: { size: 8.5, bold: true, color: { argb: P.acc } }, al: { vertical: 'middle' }, b: { bottom: { style: 'thin', color: { argb: P.acc } } } }); r++; z = 0; };
      var sumA = 0, sumT = 0, pend = null;
      /* 금액이 이미 부가세 포함인 양식(포인트나인크루 청구내역서: 세액 열 없고 항목 합 = 포함가) → 공급가액 = 금액÷1.1, 세액 = 금액−공급가액 */
      var rawSum = A.items.reduce(function(s, it){ return s + (it.amt.v || 0); }, 0);
      var vatIn = H.tax == null && A.totals.total != null && Math.abs(A.totals.total - rawSum) <= 2 && (A.totals.sub == null || Math.abs(A.totals.sub - rawSum) > 2);
      if (vatIn) warn.push('원본 금액이 부가세 포함이라 공급가액 = 금액 ÷ 1.1 로 나눠 표시');
      A.items.forEach(function(it){
        var nm = String(it.name || '').replace(/\s+/g, ' ').trim(), q = it.qty.v, p = it.price.v, a = it.amt.v;
        var isSec = /^<.*>$/.test(nm) && !q && !a;
        if (isSec){ pend = nm.replace(/^<\s*|\s*>$/g, ''); return; }   /* 구역 제목은 그 구역에 보이는 줄이 있을 때만 */
        if (nm === '(이름 없음)' && !q && !a) return;
        if (info.hideZero && !a && !q) return;   /* 0원 줄 숨기기 (화면 체크) */
        if (!nm || (!q && !a && !p && !it.note)) { if (!nm || nm === '(이름 없음)') return; }
        if (pend){ section(pend); pend = null; }
        no++; ws.getRow(r).height = 18; var zebra = (z++ % 2) ? P.zebra : null;
        var d = String(it.date || ''); if (/^\d{1,2}$/.test(d)) d = m + '.' + ('0' + d).slice(-2);
        cell('B' + r, no, { font: { size: 8, color: { argb: GRAY } }, al: { horizontal: 'center', vertical: 'middle' } });
        cell('C' + r, d || null, { font: { size: 8, color: { argb: GRAY } }, al: { horizontal: 'center', vertical: 'middle' } });
        cell('D' + r, nm.replace(/^<\s*|\s*>$/g, ''), { font: { size: 9 }, al: { vertical: 'middle', indent: 1, shrinkToFit: true } });
        cell('E' + r, it.size || null, { font: { size: 8, color: { argb: GRAY } }, al: { horizontal: 'center', vertical: 'middle', shrinkToFit: true } });
        cell('F' + r, { formula: REF(H.qty, it.r), result: q || 0 }, { font: { size: 9 }, al: { horizontal: 'right', vertical: 'middle' }, nf: NUM });
        cell('G' + r, H.price != null ? { formula: REF(H.price, it.r), result: p || 0 } : null, { font: { size: 9 }, al: { horizontal: 'right', vertical: 'middle' }, nf: NUM });
        var av = vatIn ? (a || 0) / 1.1 : (a || 0), tv = vatIn ? (a || 0) - av : (a || 0) * 0.1;
        cell('H' + r, { formula: vatIn ? 'N(' + REF(H.amt, it.r) + ')/1.1' : 'N(' + REF(H.amt, it.r) + ')', result: av }, { font: { size: 9, bold: true }, al: { horizontal: 'right', vertical: 'middle' }, nf: NUM });
        cell('I' + r, vatIn ? { formula: 'N(' + REF(H.amt, it.r) + ')-H' + r, result: tv } : H.tax != null ? { formula: 'N(' + REF(H.tax, it.r) + ')', result: tv } : { formula: 'H' + r + '*0.1', result: tv }, { font: { size: 8.5, color: { argb: GRAY } }, al: { horizontal: 'right', vertical: 'middle' }, nf: NUM });
        cell('J' + r, it.note || null, { font: { size: 7.5, color: { argb: GRAY } }, al: { vertical: 'middle', indent: 1, shrinkToFit: true } });
        for (var c = 2; c <= 10; c++){ var x = ws.getRow(r).getCell(c); x.border = { bottom: hair }; if (zebra) x.fill = F(zebra); }
        sumA += av; sumT += tv; rows.push(r); r++;
      });
      var last = Math.max(r - 1, first);
      /* 합계 */
      ws.getRow(r).height = 8; r++;
      var tot = function(lab, f, big){ ws.getRow(r).height = big ? 26 : 20; ws.mergeCells('G' + r + ':H' + r); ws.mergeCells('I' + r + ':J' + r);
        cell('G' + r, lab, { font: { size: big ? 10 : 8.5, bold: true, color: { argb: big && !P.line ? WHITE : P.main } }, fill: big && !P.line ? P.main : P.soft, al: { horizontal: 'right', vertical: 'middle', indent: 1 } });
        cell('I' + r, f, { font: { size: big ? 13 : 10, bold: true, color: { argb: big && !P.line ? WHITE : INK } }, fill: big && !P.line ? P.main : P.soft, al: { horizontal: 'right', vertical: 'middle', indent: 1 }, nf: '"₩"#,##0' });
        if (big && P.line) ['G', 'H', 'I', 'J'].forEach(function(c){ ws.getCell(c + r).border = { top: mainB, bottom: { style: 'double', color: { argb: P.main } } }; });
        return r++; };
      var rS = tot('공급가액', { formula: 'SUM(H' + first + ':H' + last + ')', result: sumA });
      var rT = tot('세액 (10%)', { formula: 'SUM(I' + first + ':I' + last + ')', result: sumT });
      var rG = tot('합계금액', { formula: 'I' + rS + '+I' + rT, result: sumA + sumT }, true);
      cell('B12', '청구금액  (VAT 포함)', { font: { size: 10, bold: true, color: { argb: P.bandSub } }, al: { vertical: 'middle', indent: 1 } });
      cell('H12', { formula: 'I' + rG, result: sumA + sumT }, { font: { size: 20, bold: true, color: { argb: P.bandTxt } }, al: { horizontal: 'right', vertical: 'middle', indent: 1 }, nf: '"₩"#,##0' });
      cell('B13', { formula: '"일금 "&NUMBERSTRING(ROUND(I' + rG + ',0),1)&"원정  (공급가액 "&TEXT(I' + rS + ',"#,##0")&" + 세액 "&TEXT(I' + rT + ',"#,##0")&")"' }, { font: { size: 8.5, color: { argb: P.main } }, al: { vertical: 'middle', indent: 1 } });
      /* 아래 */
      r++; ws.getRow(r).height = 10; r++;
      ws.mergeCells('B' + r + ':F' + r); cell('B' + r, '위와 같이 정산청구서를 보내드립니다.', { font: { size: 9 }, al: { vertical: 'middle', indent: 1 } });
      ws.mergeCells('G' + r + ':J' + r); cell('G' + r, '인수자                              (인)', { font: { size: 9, color: { argb: GRAY } }, al: { horizontal: 'right', vertical: 'middle' }, b: { bottom: { style: 'thin', color: { argb: LINE } } } }); ws.getRow(r).height = 24; r++;
      ws.getRow(r).height = 6; r++;
      ws.mergeCells('B' + r + ':D' + r); cell('B' + r, '입금계좌', { font: { size: 8, bold: true, color: { argb: P.line ? P.main : WHITE } }, fill: P.line ? P.soft : P.main, al: { vertical: 'middle', indent: 1 } });
      ws.mergeCells('E' + r + ':J' + r); cell('E' + r, SUP.bank, { font: { size: 9.5, bold: true, color: { argb: P.main } }, fill: P.soft, al: { vertical: 'middle', indent: 1 } }); ws.getRow(r).height = 24; r++;
      ws.mergeCells('B' + r + ':J' + r); cell('B' + r, '※ ' + (info.note || '세부 내역은 같은 파일의 데이터 시트에서 확인하실 수 있습니다.'), { font: { size: 7.5, color: { argb: GRAY } }, al: { vertical: 'middle', wrapText: true } }); ws.getRow(r).height = 22; r++;
      if (!P.line) box(r, 2, r, 10, P.main); else for (var c3 = 2; c3 <= 10; c3++) ws.getRow(r).getCell(c3).border = { top: { style: 'medium', color: { argb: P.main } } };
      ws.getRow(r).height = 4;
      ws.pageSetup.printArea = 'A1:K' + r;
      /* 원본 합계와 맞는지 */
      var tot0 = A.totals.total != null ? A.totals.total : (A.totals.sub != null ? A.totals.sub * 1.1 : null);
      if (tot0 != null && Math.abs(tot0 - (sumA + sumT)) > 2) warn.push('원본 합계 ' + Math.round(tot0).toLocaleString() + ' ≠ 디자인 합계 ' + Math.round(sumA + sumT).toLocaleString() + ' — 원본에서 항목 줄 밖에 더한 금액이 있는지 확인');
      wb.views = [{ activeTab: 0, firstSheet: 0 }];
      return wb.xlsx.writeBuffer().then(function(buf){ return { buf: buf, warn: warn, total: sumA + sumT }; });
    });
  }

  window.SETTLE_DESIGN = { list: Object.keys(PAL).map(function(k){ return { id: k, name: PAL[k].name, desc: PAL[k].desc }; }), build: build };
})();
