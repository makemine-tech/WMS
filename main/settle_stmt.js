/* ============================================================
   정산서 표본 분석 — 지난달 완료 거래내역서를 읽어 "어떻게 만들어졌는지" 풀어낸다
   (settlement.html 업체 정산 탭에서 사용 · 브라우저/노드 공용, 전역 XLSX 필요)

   analyzeStatement(wb) → {
     sheet   : 거래명세표 시트 이름 (첫 시트)
     items   : [{ r(행번호 1부터), name, size, qty:{v,f,src}, price:{v,f}, amt:{v,f}, note, zero }]
     totals  : { sub, total }  — 소계·합계 줄 값
     sheets  : [{ name, rows, headers[], kind:{key,label}|null, usedBy:[항목 행번호] }]  — 나머지 데이터 시트
   }
   수량 출처(src)는 수식을 사람이 읽는 말로: 피벗표(필드=값), 다른 시트 칸, 다른 줄 합, 직접 입력.
============================================================ */
(function(){
  'use strict';
  var U = function(){ return XLSX.utils; };
  function txt(v){ return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function nospace(v){ return String(v == null ? '' : v).replace(/\s+/g, ''); }

  /* 데이터 시트 종류 추정 — 제목줄 글자로 */
  var KINDS = [
    { key:'ebut_shiplist', label:'이벗 택배비 리스트', need:['판매처명','택배크기','송장번호'] },
    { key:'ebut_orders',   label:'이벗 주문목록',      need:['판매처','송장번호','수령자'] },
    { key:'ebut_orders',   label:'이벗 주문목록',      need:['코드','상태','운송장','판매처'] },
    { key:'bnc_return',    label:'박스앤캔 택배비 (반품)', need:['등기번호','박스크기','납부방법'] },
    { key:'bnc_courier',   label:'박스앤캔 택배비 (발송)', need:['등기번호','박스크기','발송인명'] },
    { key:'cargo_store',   label:'화물 입출고 (보관 파렛트)', need:['보관일'] },
    { key:'cargo_store',   label:'화물 입출고 (보관 파렛트)', need:['입출고현황'] },
    { key:'freight',       label:'화물·용차비 청구서',  need:['출발지','도착지','차종'] },
    { key:'coupang_po',    label:'쿠팡 발주서·입고내역', need:['발주번호','물류센터'] },
    { key:'p9_row',        label:'포인트나인크루 출고 ROW', need:['발주일','모데명','송장번호'] },
    { key:'ebut_stock',    label:'이벗 재고현황',       need:['가용재고수량'] },
    { key:'ebut_instock',  label:'이벗 입고 목록',      need:['입고일','가용입고'] },
    { key:'ebut_outlist',  label:'이벗 출고 목록',      need:['출고일','가용출고수량'] },
    { key:'jeju_stock',    label:'제주맥주 재고표',     need:['전산재고','실재고조사수량'] }
  ];
  function kindOf(headers){
    var h = new Set(headers.map(nospace));
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].need.every(function(x){ return h.has(nospace(x)); })) return { key: KINDS[i].key, label: KINDS[i].label };
    return null;
  }

  /* 수식 → 사람이 읽는 출처 */
  function explain(f, selfSheet){
    if (!f) return { text: '직접 입력', sheets: [], kind: 'input' };
    var sheets = [], m, re = /(?:'([^']+)'|([A-Za-z0-9_가-힣]+))!\$?[A-Z]{1,3}\$?\d+/g;
    while ((m = re.exec(f))) { var s = m[1] || m[2]; if (s && sheets.indexOf(s) < 0) sheets.push(s); }
    var gp = f.match(/GETPIVOTDATA\("([^"]+)",\s*([^,)]+)((?:,\s*"[^"]*",\s*(?:"[^"]*"|[\d.]+))*)\)/i);
    if (gp){
      var conds = [], cm, cre = /"([^"]*)",\s*("([^"]*)"|([\d.]+))/g;
      while ((cm = cre.exec(gp[3]))) conds.push(cm[1] + '=' + (cm[3] != null ? cm[3] : cm[4]));
      var anchor = gp[2].replace(/\$/g, '');
      var on = anchor.indexOf('!') > 0 ? anchor.split('!')[0].replace(/'/g, '') : '';
      if (on && sheets.indexOf(on) < 0) sheets.push(on);
      return { text: '피벗 「' + gp[1] + '」' + (conds.length ? ' · ' + conds.join(', ') : ' 합계') + (on ? ' (시트 ' + on + ')' : ' (표 ' + anchor + ')'),
        sheets: sheets, kind: 'pivot', field: gp[1], conds: conds };
    }
    if (sheets.length) return { text: '시트 「' + sheets.join('」「') + '」 ' + (f.replace(/'[^']+'!|[A-Za-z0-9_가-힣]+!/g, '').slice(0, 40)), sheets: sheets, kind: 'ref' };
    if (/^SUM\(/i.test(f)) return { text: '다른 줄 합 (' + f.slice(4, -1) + ')', sheets: [], kind: 'sum' };
    return { text: '계산 (' + f.slice(0, 40) + ')', sheets: [], kind: 'calc' };
  }

  /* 머리줄 찾기: 내역(품명)·수량·단가/금액 */
  function findHeader(ws){
    var r = U().decode_range(ws['!ref']);
    for (var R = 0; R <= Math.min(r.e.r, 20); R++){
      var m = {};
      for (var C = 0; C <= Math.min(r.e.c, 30); C++){
        var c = ws[U().encode_cell({ r: R, c: C })]; if (!c || typeof c.v !== 'string') continue;
        var t = nospace(c.v);
        if (/^(내역|품명)/.test(t)) m.item = C;
        else if (/^수량/.test(t)) m.qty = C;
        else if (/^단가/.test(t)) m.price = C;
        else if (/^금액/.test(t) || (/^공급가액/.test(t) && m.amt == null)) m.amt = C;
        else if (/^구분/.test(t)) m.grp = C;
        else if (/^규격/.test(t)) m.size = C;
        else if (/^비고/.test(t)) m.note = C;
        else if (/^세액/.test(t)) m.tax = C;
      }
      if (m.qty != null && m.item != null && (m.price != null || m.amt != null)){ m.R = R; return m; }
    }
    return null;
  }

  function cellOf(ws, R, C){ if (C == null) return null; return ws[U().encode_cell({ r: R, c: C })] || null; }
  function num(c){ return c && typeof c.v === 'number' ? c.v : (c && c.v !== '' && isFinite(Number(c.v)) ? Number(c.v) : null); }

  function analyzeStatement(wb){
    var sn = wb.SheetNames[0], ws = wb.Sheets[sn];
    var out = { sheet: sn, items: [], totals: {}, sheets: [], header: null };
    if (!ws || !ws['!ref']) return out;
    var H = findHeader(ws); out.header = H;
    var rng = U().decode_range(ws['!ref']);
    if (H){
      var grp = '', ended = false;
      /* 맺음 줄(소계·합계) 글자는 명세표 칸(금액·세액·비고 열까지)에서만 — 오른쪽 옆 표의 「합계」를 명세표 합계로 읽지 않게 (2026-10-05 스타 온라인세일즈 합계 0) */
      var lastC = Math.max(H.amt != null ? H.amt : 0, H.tax != null ? H.tax : 0, H.note != null ? H.note : 0) + 3;
      for (var R = H.R + 1; R <= rng.e.r; R++){
        /* 줄 전체 글자 — 소계·합계·포함가 줄이면 끝 */
        var line = [];
        for (var C = 0; C <= Math.min(rng.e.c, 30); C++){ var cc = ws[U().encode_cell({ r: R, c: C })]; if (cc && cc.v !== '' && cc.v != null) line.push({ C: C, c: cc }); }
        var own = line.filter(function(x){ return x.C <= lastC; });
        var lineTxt = own.map(function(x){ return typeof x.c.v === 'string' ? nospace(x.c.v) : ''; }).join('|');
        /* 맺음 줄 — 소계·공급가액 = 공급가, 합계·포함가 = 부가세 포함. 하나라도 나오면 항목은 끝 */
        var lastNum = own.filter(function(x){ return typeof x.c.v === 'number'; }).pop();
        if (/(^|\|)(소계|공급가액)(\||$)/.test(lineTxt)){ ended = true; var sc = cellOf(ws, R, H.amt); out.totals.sub = num(sc) != null ? num(sc) : (lastNum ? lastNum.c.v : null); continue; }
        if (/(^|\|)(합계|포함가)(\||$)/.test(lineTxt)){ ended = true;
          if (out.totals.total == null){
            /* 합계 줄에 공급가액·세액 칸이 따로 있으면 둘을 더함 (엠에스컴퍼니 거래내역서: 「합 계 | 387,273 | 38,727」 — 마지막 숫자 = 세액을 합계로 읽던 것) */
            var ta = num(cellOf(ws, R, H.amt)), tt = H.tax != null ? num(cellOf(ws, R, H.tax)) : null;
            out.totals.total = ta != null && tt != null && tt < ta ? ta + tt : (lastNum ? lastNum.c.v : null);
            if (ta != null && tt != null && tt < ta && out.totals.sub == null) out.totals.sub = ta; }
          continue; }
        if (/(^|\|)(세액|전잔금|입금|잔금)(\||$)/.test(lineTxt)){ ended = true; continue; }
        if (ended) continue;
        var gC = cellOf(ws, R, H.grp), iC = cellOf(ws, R, H.item), dC = H.grp != null ? cellOf(ws, R, H.item + 1) : null;
        if (gC && txt(gC.v)) grp = txt(gC.v);
        var name = [H.grp != null ? grp : '', iC ? txt(iC.v) : '', dC && typeof dC.v === 'string' ? txt(dC.v) : ''].filter(Boolean).join(' · ');
        var q = cellOf(ws, R, H.qty), p = cellOf(ws, R, H.price), a = cellOf(ws, R, H.amt);
        var qv = num(q), pv = num(p), av = num(a);
        if (!name && !qv && !av) continue;
        /* 비고 = 금액·세액 오른쪽의 글자 (옆에 붙은 피벗표 글자는 뺀다) */
        var PIV = /^(총합계|행 레이블|열 레이블|(합계|개수|평균) : .*|\(비어 있음\)|극소|소|중|대|이형|\d+)$/;
        var note = line.filter(function(x){ return typeof x.c.v === 'string' && x.C > (H.tax != null ? H.tax : H.amt) && x.C !== H.item && x.C !== H.grp && !PIV.test(txt(x.c.v)); })
          .map(function(x){ return txt(x.c.v); }).join(' / ');
        if (H.note != null){ var nc = cellOf(ws, R, H.note); if (nc && typeof nc.v === 'string' && note.indexOf(txt(nc.v)) < 0) note = (note ? note + ' / ' : '') + txt(nc.v); }
        var dateC = H.item > 0 ? cellOf(ws, R, 0) : null;
        out.items.push({
          r: R + 1, name: name || '(이름 없음)', date: dateC && (typeof dateC.v === 'number' || typeof dateC.v === 'string') && H.grp == null ? txt(dateC.v) : '',
          size: H.size != null && cellOf(ws, R, H.size) ? txt(cellOf(ws, R, H.size).v) : '',
          qty: { v: qv, f: q && q.f ? q.f : null, src: explain(q && q.f, sn) },
          price: { v: pv, f: p && p.f ? p.f : null }, amt: { v: av, f: a && a.f ? a.f : null },
          note: note.slice(0, 200), zero: !qv && !av
        });
      }
    }
    /* 데이터 시트 */
    var usage = {};
    out.items.forEach(function(it){ (it.qty.src.sheets || []).forEach(function(s){ (usage[s] = usage[s] || []).push(it.r); });
      if (it.price.f) explain(it.price.f).sheets.forEach(function(s){ (usage[s] = usage[s] || []).push(it.r); }); });
    wb.SheetNames.slice(1).forEach(function(n){
      var s = wb.Sheets[n]; if (!s || !s['!ref']){ out.sheets.push({ name: n, rows: 0, headers: [], kind: null, usedBy: usage[n] || [] }); return; }
      var aoa = U().sheet_to_json(s, { header: 1, defval: '', blankrows: false });
      var best = [], bi = 0;
      for (var i = 0; i < Math.min(aoa.length, 12); i++){ var rr = aoa[i].filter(function(v){ return typeof v === 'string' && v.trim(); }); if (rr.length > best.length){ best = rr; bi = i; } }
      var headers = best.map(txt);
      out.sheets.push({ name: n, rows: Math.max(0, aoa.length - bi - 1), headers: headers, kind: kindOf(headers), usedBy: usage[n] || [] });
    });
    /* 피벗 출처 추정 — 피벗 필드 이름이 제목줄에 있는 시트 */
    out.items.forEach(function(it){
      var s = it.qty.src; if (s.kind !== 'pivot' || s.sheets.length) return;
      var keys = [s.field].concat((s.conds || []).map(function(c){ return c.split('=')[0]; })).map(nospace);
      var hit = out.sheets.filter(function(sh){ var h = sh.headers.map(nospace); return keys.filter(function(k){ return h.indexOf(k) >= 0; }).length >= Math.min(2, keys.length); });
      if (hit.length){ s.guess = hit[0].name; s.text += ' → 원본 시트 「' + hit[0].name + '」 추정'; (hit[0].usedBy = hit[0].usedBy || []).push(it.r); }
    });
    return out;
  }

  /* 파일 이름에서 업체명: 08월_거래내역서_포인트나인크루.xlsx → 포인트나인크루 */
  function vendorFromFile(name){
    var m = String(name || '').match(/^\d{1,2}월_거래내역서_(.+?)\.(xlsx|xls|xlsm)$/i);
    return m ? m[1] : String(name || '').replace(/\.(xlsx|xls|xlsm)$/i, '');
  }

  var api = { analyze: analyzeStatement, explain: explain, kindOf: kindOf, vendorFromFile: vendorFromFile };
  if (typeof window !== 'undefined') window.SETTLE_STMT = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
