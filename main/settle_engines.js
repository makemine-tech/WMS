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
/* 화물 청구서·입출고 기록에서 업체를 다른 이름으로 적는 경우 (화물 흔적 찾기용, settle_build.js traceCargo) */
var SETTLE_ALIASES = window.SETTLE_ALIASES = { 'HK홀세일': ['에이치케이', 'HK'], '멘소래담': ['맨소래담', '맨소래덤'] };

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
  SETTLE_ENGINES['포인트나인크루_용차비'] = { traceSkip: true,
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
      { d: '2026-10-02', t: '엑셀에 점검 시트는 넣지 않음 (적용 결과는 화면에만)' },
      { d: '2026-10-02', t: '청구서 업체명 표기가 달라도 같은 업체 — 띄어쓰기·괄호 없음(포인트나인크루곡물·포인트나인크루 당쉼) 포함, 회송 건도 포함' },
      { d: '2026-10-02', t: '금액은 청구서 확인 화면에서 수정한 값이 우선 (수정 안 한 건은 Sheet1 금액)' }
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

/* 이벗 주문 같은 줄 판별 (2026-10-03): 이벗 주문목록을 여러 개(전체 + 위탁판매·추가분) 올리면 열 구성이 달라도 같은 주문이 겹침 →
   주문번호·송장번호·상품명·옵션·수량·판매처로 같은 줄을 한 번만 (H = 띄어쓰기 뺀 제목 배열, r = 원본 줄) */
window.orderKey = function(H, r){
  var iCode = H.indexOf('코드');   /* 이벗 주문줄 고유 번호 — 있으면 이걸로 (같은 주문 안의 같은 상품 두 줄도 따로) */
  if (iCode >= 0 && String(r[iCode] == null ? '' : r[iCode]).trim()) return 'code\u0001' + String(r[iCode]).trim();
  var cols = ['주문번호', '송장번호', '상품명', '옵션', '수량', '판매처'], ix = cols.map(function(c){ return H.indexOf(c); });
  if (ix[0] < 0 && ix[1] < 0) return r.join('\u0001');
  /* 주문번호·송장번호가 둘 다 비면(직납 등) 서로 다른 주문을 같은 줄로 보지 않게 — 그 파일 줄 전체로 (9월 플라잉피그 직납 9건이 합쳐지던 것) */
  var on = ix[0] < 0 ? '' : String(r[ix[0]] == null ? '' : r[ix[0]]).trim(), iv = ix[1] < 0 ? '' : String(r[ix[1]] == null ? '' : r[ix[1]]).trim();
  if (!on && !iv) return 'row\u0001' + r.join('\u0001');
  return ix.map(function(i){ return i < 0 ? '' : String(r[i] == null ? '' : r[i]).replace(/\s+/g, ''); }).join('\u0001');
};

/* 업체 이름 맞추기 (2026-10-03): 화물 청구서·입출고 기록·택배 리스트에서 「이 업체」 줄 찾기 공통
   핵심 이름 = 메이크마인디자인_·_당월분·_계산서미발행·__0000원·(괄호) 뗀 뒤 맨 끝 '_' 조각 (제주맥주위탁_만월회 → 만월회)
   + 괄호 안 이름(제이에스로지원(테일즈코리아) → 테일즈코리아) + SETTLE_ALIASES 별칭 + extra
   맞음 = 기록 이름에 핵심 이름이 들어 있거나, 기록 이름(3자 이상)이 핵심 이름의 앞부분(테일즈 ↔ 테일즈코리아) */
window.vendorMatcher = function(name, extra){
  var norm = function(v){ return String(v == null ? '' : v).replace(/[\s()]/g, '').toLowerCase(); };
  var raw = String(name || ''), c = raw.replace(/^메이크마인디자인_/, '').replace(/_(당월분|계산서미발행|\d.*)$/, '').replace(/__.*$/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  var segs = c.split('_').filter(Boolean), main = segs[segs.length - 1] || c;
  var par = (raw.match(/\(([^)]+)\)/g) || []).map(function(x){ return x.slice(1, -1); });
  var keys = [main].concat(par, (window.SETTLE_ALIASES || {})[raw] || [], extra || []).map(norm).filter(function(k, i, a){ return k.length >= 2 && a.indexOf(k) === i; });
  var f = function(v){ var s = norm(v); if (!s) return false; return keys.some(function(k){ return s.indexOf(k) >= 0 || (k.indexOf(s) === 0 && (s.length >= 3 || (s.length === 2 && k.length <= 4))); }); };   /* 「신성」 → 신성애드 처럼 짧게 적은 이름도 */
  f.keys = keys; f.main = main; return f;
};

/* 택배비·배송비 시트 공통 마무리 (대표님 2026-10-03, 신성애드만이 아니라 같은 모양 시트 전부)
   시트 열: 등록일·출고일·판매처명·수령자·주문정보·수량·매칭정보·매칭총수량·상품종류·출력양식·발송정보·택배크기·택배비·추가운임·…·송장번호·건수
   · 택배크기 = 대표님이 직접 확인·수정 → 노란 칸
   · 추가운임 = 이벗 전체주문목록에서 같은 송장번호의 주소가 「제주」로 시작하면 400
   · 거래명세표 택배발송(극소·소·중·대) 수량 = 이 시트 택배크기 COUNTIF 수식(택배크기를 고치면 따라 바뀜), 항공비/제주도 = 추가운임 있는 줄 수 */
window.shipSheetFinish = function(wb, sheetName, st, ctx, opt){
  opt = opt || {};   /* noSizeYellow: 택배크기를 룰로 정한 업체(멘소래담 = 기본 극소)는 노란 칸 안 함 */
  var ws = wb.getWorksheet(sheetName), log = ctx.log; if (!ws) return Promise.resolve();
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var ns = function(v){ if (v && v.richText) v = v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) v = v.result; return String(v == null ? '' : v).replace(/\s+/g, ''); };
  var col = {}; ws.getRow(1).eachCell(function(c, n){ var h = ns(c.value); if (h && col[h] == null) col[h] = n; });
  var cZ = col['택배크기'], cA = col['추가운임'], cN = col['송장번호']; if (!cZ || !cN) return Promise.resolve();
  var last = 1; ws.eachRow(function(row, r){ if (r > 1 && ns(row.getCell(cN).value)) last = r; });
  var box = ctx.BOX || {}, ids = Object.keys(box).filter(function(id){ return box[id].type === 'ebut_orders'; }), jeju = {};
  return ids.reduce(function(p, id){ return p.then(function(){ return ctx.readBox(box[id]).then(function(x){
    var a = XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
    var H = a[0].map(ns), iN = H.indexOf('송장번호'), iA = H.indexOf('주소'); if (iN < 0 || iA < 0) return;
    a.slice(1).forEach(function(r){ var v = String(r[iN] || '').trim(); if (v && /^\s*제주/.test(String(r[iA] || ''))) jeju[v] = 1; });
  }); }); }, Promise.resolve()).then(function(){
    var nJ = 0, cnt = { 극소: 0, 소: 0, 중: 0, 대: 0 }, nAdd = 0;
    for (var r = 2; r <= last; r++){ var row = ws.getRow(r), inv = ns(row.getCell(cN).value); if (!inv) continue;
      var z = row.getCell(cZ); if (!opt.noSizeYellow) z.style = Object.assign({}, z.style, { fill: YEL }); var zz = ns(z.value); if (cnt[zz] != null) cnt[zz]++;
      if (cA){ var ad = row.getCell(cA); if (jeju[inv]){ ad.value = 400; nJ++; } if (+ns(ad.value) > 0) nAdd++; } }
    var L = function(n){ return ws.getColumn(n).letter; }, rngZ = "'" + sheetName + "'!" + L(cZ) + '2:' + L(cZ) + Math.max(2, last), rngA = cA ? "'" + sheetName + "'!" + L(cA) + '2:' + L(cA) + Math.max(2, last) : null;
    var lab = function(b){ return b.replace(/\s+/g, ''); }, sizeOf = function(b){ if (!/택배|발송|배송/.test(b)) return null; if (/극소/.test(b)) return '극소'; if (/\(소\)|소$/.test(b)) return '소'; if (/\(중\)|중$/.test(b)) return '중'; if (/\(대\d?\)|대\d?$/.test(b)) return '대'; return null; };
    if (st) st.eachRow(function(row, r){ var b = lab(ns(row.getCell(2).value) + ns(row.getCell(3).value)); if (!b) return; var g = row.getCell(7), z = sizeOf(b);
      if (z){ g.value = { formula: 'COUNTIF(' + rngZ + ',"' + z + '")', result: cnt[z] }; if (!opt.noSizeYellow) g.style = Object.assign({}, g.style, { fill: YEL }); }
      else if (rngA && /항공|제주도|추가운임/.test(b)){ g.value = { formula: 'COUNTIF(' + rngA + ',">0")', result: nAdd }; } });
    log.push(['자동 적용', '시트 「' + sheetName + '」 추가운임: 이벗 주소가 제주인 송장 ' + nJ + '건 = 400 · 택배크기 칸 노란색(직접 확인) · 거래명세표 택배 건수는 택배크기 COUNTIF 수식(고치면 따라 바뀜)']);
    if (nJ && st) log.push(['특이사항', '제주 추가운임 400 ' + nJ + '건 — 거래명세표 항공비/제주도 줄 단가가 400 인지 확인']);
  });
};
