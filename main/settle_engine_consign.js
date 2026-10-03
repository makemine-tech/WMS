/* ============================================================
   정산관리 — 제주누보 위탁판매 업체들 (settle_engines.js 와 같은 형식)
   2026-10-03 대표님 문답 룰. 바꿀 땐 대화창에서 요청 → 여기 고치고 ruleList 에 추가.

   공통: 이번 달 파일함 「이벗 전체주문목록」(여러 개면 합침, 같은 줄은 한 번만)에서 판매처가 그 업체인 줄만 →
         캔 수 = 「매칭수량」 열(상품명·수량보다 정확 — 12캔 × 수량 2 = 24)
         데이터 시트(지난달 표본의 그 시트)를 이번 달 줄로 새로 쓰고 오른쪽에 캔수·공급가(VAT 포함)·택배건수·택배비,
         맨 아래 합계 줄 → 거래명세표 그 줄의 단가(F)·수량(G)이 합계 칸을 가리키게
   업체별 공급가:
     데일리샷      판매가 × 0.9 (판매가 6캔 18,600 · 12캔 38,900 · 24캔 58,900), 택배비 없음
     브라이트커머스 캔당 1,750 + 택배 건당(송장) 3,000
     플라잉피그    캔당 1,760, 택배비 없음 (직납)
     만월회        가격표(송장 캔 합계) 1캔 1,960 · 3캔 5,880 · 6캔 11,130 · 12캔 20,860 · 24캔 41,860 + 택배 송장당 3,000(24캔 넘으면 24캔마다 3,000)
     경문          캔당 1,600 + 택배 건당 3,000 · 이벗 시스템 사용료 55,000 고정 · 초콜릿 부분은 아직 룰 없음(0원 + 노란 칸)
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  var LINE = { style: 'thin', color: { argb: 'FFD0D7E2' } }, BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); return v == null ? '' : String(v); }
  function nsp(v){ return txt(v).replace(/\s+/g, ''); }
  function colL(n){ var s = ''; while (n > 0){ var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /* 이벗 주문목록들 → 그 판매처 줄 (머리줄 기준 열 찾기, 같은 줄 중복 제거) */
  function readOrders(ctx, sellerRe){
    var box = ctx.BOX || {}, ids = Object.keys(box).filter(function(id){ return box[id].type === 'ebut_orders'; });
    if (!ids.length) return Promise.resolve(null);
    var head = null, rows = [], seen = {};
    return ids.reduce(function(p, id){ return p.then(function(){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(xwb){
      var a = XLSX.utils.sheet_to_json(xwb.Sheets[xwb.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
      var H = a[0].map(nsp), iS = H.indexOf('판매처'); if (iS < 0) return;
      if (!head) head = a[0].map(function(h){ return String(h); });
      var map = head.map(function(h){ return H.indexOf(nsp(h)); });
      a.slice(1).forEach(function(r){ if (!sellerRe.test(String(r[iS]).trim())) return;
        var o = map.map(function(j){ return j < 0 ? '' : r[j]; }), k = o.join('\u0001'); if (seen[k]) return; seen[k] = 1; rows.push(o); });
    }); }); }, Promise.resolve()).then(function(){ return { head: head || [], rows: rows }; });
  }

  /* 데이터 시트 새로 쓰기 (같은 이름·같은 순서) */
  function rewrite(wb, name, head, rows){
    var old = wb.getWorksheet(name), ord = old ? old.orderNo : undefined, tab = old && old.properties ? old.properties.tabColor : undefined;
    if (old) wb.removeWorksheet(old.id);
    var ws = wb.addWorksheet(name); if (ord != null) ws.orderNo = ord; if (tab) ws.properties.tabColor = tab;
    ws.addRow(head); rows.forEach(function(r){ ws.addRow(r); });
    var hr = ws.getRow(1); hr.height = 22;
    for (var c = 1; c <= head.length; c++){ var h = hr.getCell(c); h.fill = HEAD; h.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; h.border = BORDER; }
    for (var r = 2; r <= rows.length + 2; r++){ var row = ws.getRow(r); for (var c2 = 1; c2 <= head.length; c2++){ var cl = row.getCell(c2); cl.border = BORDER; cl.font = { name: '맑은 고딕', size: 10 }; } }
    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A1', showGridLines: false }];
    return ws;
  }

  /* 거래명세표에서 내역(B열) 글자로 줄 찾기 */
  function lineRow(st, re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(nsp(row.getCell(2).value))) hit = r; }); return hit; }

  function consign(cfg){
    return {
      items: cfg.items || {}, sheets: cfg.sheets || {}, verified: cfg.verified || {}, opt: {}, ruleList: cfg.ruleList,
      afterBuild: function(wb, ctx){
        var log = ctx.log, won = ctx.won, st = ctx.st;
        return readOrders(ctx, cfg.seller).then(function(D){
          if (!D){ log.push(['확인 필요', '파일함에 이번 달 이벗 전체주문목록이 없습니다 — 위탁판매 내역을 못 채웠어요']); return; }
          var H = D.head.map(nsp), iN = H.indexOf('송장번호'), iC = H.indexOf('매칭수량'), iQ = H.indexOf('수량');
          var iP = H.indexOf('상품명'), iO = H.indexOf('옵션'), byName = 0;
          /* 매칭수량이 비어 있으면(옛 내보내기) 상품명·옵션의 캔 수(6캔 · *24 · 24개) × 수량 */
          var cans = function(r){ var v = +r[iC]; if (v > 0) return v;
            var s = String(r[iP] || '') + ' ' + String(r[iO] || '');
            if (/---\s*\d+\s*개\s*\$/.test(s)) return +r[iQ] || 0;   /* 「제주누보 355ml---24개$」 형식은 수량 = 캔 수 */
            var m = s.match(/(\d+)\s*캔/) || s.match(/\*\s*(\d+)/) || s.match(/(\d+)\s*개/), q = +r[iQ] || 0;
            if (m){ byName++; return +m[1] * (q || 1); } return q; };
          /* 송장 묶음 (송장 없는 직납은 줄마다) */
          var grp = {}, order = [];
          D.rows.forEach(function(r, i){ var k = String(r[iN] || '').trim() || ('직납#' + i); if (!grp[k]){ grp[k] = []; order.push(k); } grp[k].push(i); });
          var amt = D.rows.map(function(){ return 0; }), ship = D.rows.map(function(){ return 0; }), boxes = D.rows.map(function(){ return 0; }), odd = [];
          order.forEach(function(k){ var ix = grp[k], c = ix.reduce(function(s, i){ return s + cans(D.rows[i]); }, 0), first = ix[0], direct = /^직납#/.test(k);
            if (cfg.table){ var v = cfg.table[c]; if (v == null){ odd.push(k + ' ' + c + '캔'); v = 0; } amt[first] = v; }
            else ix.forEach(function(i){ var n = cans(D.rows[i]);
              if (cfg.pctOf){ var p = cfg.pctOf[n]; if (p == null){ odd.push(k + ' ' + n + '캔'); p = 0; } amt[i] = Math.round(p * cfg.pct); }
              else amt[i] = n * cfg.rate; });
            if (cfg.ship && !direct){ var b = cfg.shipPer24 ? Math.max(1, Math.ceil(c / 24)) : 1; boxes[first] = b; ship[first] = b * cfg.ship; } });
          var head = D.head.concat(['캔수', '공급가(VAT포함)', '택배건수', '택배비']), base = D.head.length;
          var rows = D.rows.map(function(r, i){ return r.concat([cans(r), amt[i] || null, boxes[i] || null, ship[i] || null]); });
          var ws = rewrite(wb, cfg.sheet, head, rows), T = rows.length + 2;
          var cC = colL(base + 1), cA = colL(base + 2), cB = colL(base + 3), cS = colL(base + 4);
          var sum = function(c, v){ ws.getCell(c + T).value = rows.length ? { formula: 'SUM(' + c + '2:' + c + (T - 1) + ')', result: v } : 0; ws.getCell(c + T).font = { name: '맑은 고딕', size: 10, bold: true }; };
          var tC = rows.reduce(function(s, r){ return s + (+r[base] || 0); }, 0), tA = amt.reduce(function(s, x){ return s + x; }, 0), tB = boxes.reduce(function(s, x){ return s + x; }, 0), tS = ship.reduce(function(s, x){ return s + x; }, 0);
          ws.getCell('A' + T).value = '합계'; ws.getCell('A' + T).font = { name: '맑은 고딕', size: 10, bold: true };
          sum(cC, tC); sum(cA, tA); sum(cB, tB); sum(cS, tS);
          [cA, cS].forEach(function(c){ ws.getColumn(c).numFmt = '#,##0'; });
          [base + 1, base + 2, base + 3, base + 4].forEach(function(n){ ws.getColumn(n).width = 13; });
          var ref = function(c){ return "'" + cfg.sheet + "'!" + c + T; };
          /* 거래명세표 줄 */
          var put = function(re, F, G, why, col){ var r = lineRow(st, re); if (!r){ log.push(['확인 필요', '거래명세표에서 「' + why + '」 줄을 못 찾음']); return; }
            st.getCell((col || 'F') + r).value = F; st.getCell('G' + r).value = G; };
          cfg.lines.forEach(function(L){
            if (L.kind === 'sales') put(L.re, { formula: ref(cA), result: tA }, 1, L.name, L.col);
            else if (L.kind === 'shipQty') put(L.re, cfg.ship, { formula: ref(cB), result: tB }, L.name);
            else if (L.kind === 'shipSum') put(L.re, { formula: ref(cS), result: tS }, 1, L.name);
            else if (L.kind === 'zero'){ var r = lineRow(st, L.re); if (r){ st.getCell('F' + r).value = 0; st.getCell('F' + r).fill = YEL; log.push(['확인 필요', L.name + ' — 룰이 아직 없어 0원 (노란 칸, 직접 확인)']); } }
          });
          if (byName) log.push(['안내', '매칭수량이 비어 있는 줄은 상품명의 캔 수 × 수량으로 셈']);
          if (odd.length) log.push(['특이사항', '가격표에 없는 캔 수 ' + odd.length + '건 → 0원 (직접 확인): ' + odd.slice(0, 8).join(' · ')]);
          var total = tA + tS + (cfg.fixed || 0);
          log.push(['자동 적용', cfg.sheet + ' ← 이벗 판매처 ' + cfg.sellerName + ' ' + rows.length + '줄 · 송장 ' + order.filter(function(k){ return !/^직납#/.test(k); }).length + '건 · ' + tC + '캔 → 공급가 ' + won(tA) + (tS ? ' + 택배 ' + won(tS) : '') + (cfg.fixed ? ' + 고정 ' + won(cfg.fixed) : '') + ' = 포함가 ' + won(total)]);
          if (!rows.length) log.push(['특이사항', '이번 달 ' + cfg.sellerName + ' 주문이 없습니다 — 0원']);
        });
      }
    };
  }

  var R = function(t){ return { d: '2026-10-03', t: t }; };
  var COMMON = R('이벗 전체주문목록에서 판매처가 이 업체인 줄만, 캔 수 = 매칭수량 열 — 데이터 시트를 이번 달 줄로 새로 쓰고 오른쪽 캔수·공급가·택배건수·택배비 + 합계 줄, 거래명세표가 그 합계를 가리킴');

  E['메이크마인디자인_데일리샷'] = consign({ seller: /^제주누보_데일리샷$/, sellerName: '제주누보_데일리샷', sheet: '위탁발송판매',
    pctOf: { 6: 18600, 12: 38900, 24: 58900 }, pct: 0.9,
    lines: [{ kind: 'sales', re: /^위탁발송$/, name: '위탁발송' }],
    items: { 8: 'auto' }, sheets: { '위탁발송판매': 'skip' }, verified: { 8: true },   /* 8월 원본 → 33,480 일치 */
    ruleList: [COMMON, R('공급가 = 판매가 × 0.9 (판매가 6캔 18,600 · 12캔 38,900 · 24캔 58,900), 택배비 없음 — 거래명세표 위탁발송 한 줄')] });

  E['브라이트커머스'] = consign({ seller: /^제주누보_브라이트커머스$/, sellerName: '제주누보_브라이트커머스', sheet: '제주누보및초콜릿판매',
    rate: 1750, ship: 3000,
    lines: [{ kind: 'sales', re: /^<위탁판매>$/, name: '<위탁판매>', col: 'R' }, { kind: 'shipQty', re: /^택배건$/, name: '택배건' }],
    items: { 9: 'auto', 10: 'auto' }, sheets: { '제주누보및초콜릿판매': 'skip' }, verified: { 9: true, 10: true },   /* 8월 → 45,000 일치 */
    ruleList: [COMMON, R('공급가 = 캔당 1,750 × 캔 수, 택배 = 송장 건당 3,000 (둘 다 VAT 포함)')] });

  E['메이크마인디자인_플라잉피그'] = consign({ seller: /^제주누보_플라잉피그$/, sellerName: '제주누보_플라잉피그', sheet: '위탁발송판매',
    rate: 1760,
    lines: [{ kind: 'sales', re: /^위탁발송$/, name: '위탁발송' }, { kind: 'shipQty', re: /^위탁발송택배비$/, name: '위탁발송택배비' }],
    items: { 8: 'auto', 9: 'auto' }, sheets: { '위탁발송판매': 'skip', '직납': 'skip' }, verified: { 8: true, 9: true },   /* 8월 → 42,240 일치 */
    ruleList: [COMMON, R('공급가 = 캔당 1,760 × 캔 수, 택배비 없음 (9월은 송장 없는 직납)')] });

  E['메이크마인디자인_제주맥주위탁_만월회'] = consign({ seller: /^제주누보_만월회$/, sellerName: '제주누보_만월회', sheet: '위탁발송판매',
    table: { 1: 1960, 3: 5880, 6: 11130, 12: 20860, 24: 41860 }, ship: 3000, shipPer24: true,
    lines: [{ kind: 'sales', re: /^위탁발송$/, name: '위탁발송' }, { kind: 'shipQty', re: /^위탁발송택배비$/, name: '위탁발송택배비' }],
    items: { 8: 'auto', 9: 'auto' }, sheets: { '위탁발송판매': 'skip', '직납': 'skip' }, verified: { 8: true, 9: true },   /* 8월 → 47,720 일치 */
    ruleList: [COMMON, R('공급가 = 송장 캔 합계로 가격표(VAT 포함) 1캔 1,960 · 3캔 5,880 · 6캔 11,130 · 12캔 20,860 · 24캔 41,860 — 표에 없는 캔 수는 특이사항'), R('택배 = 송장당 3,000, 24캔 넘으면 24캔마다 3,000 추가')] });

  E['경문'] = consign({ seller: /^제주맥주_경문$/, sellerName: '제주맥주_경문', sheet: '03_제주맥주위탁',
    rate: 1600, ship: 3000, fixed: 55000,
    lines: [{ kind: 'sales', re: /^제주맥주사입및위탁판매내역$/, name: '제주맥주사입및위탁판매내역' }, { kind: 'shipSum', re: /^제주맥주택배발송비$/, name: '제주맥주 택배발송비' },
            { kind: 'zero', re: /^초콜릿위탁판매$/, name: '초콜릿 위탁판매' }, { kind: 'zero', re: /^초콜릿쿠팡납품내역$/, name: '초콜릿 쿠팡납품내역' }],
    items: { 12: 'auto', 13: 'auto', 19: 'fixed' }, sheets: { '03_제주맥주위탁': 'skip', '01_초콜릿위탁발송': 'skip', '02_초콜릿매입': 'skip', '경문판매내역': 'skip' },
    ruleList: [COMMON, R('제주누보(판매처 제주맥주_경문) = 캔당 1,600 × 캔 수 + 택배 송장 건당 3,000 (VAT 포함)'), R('이벗 시스템 사용료 55,000 매달 고정'), R('초콜릿 위탁판매·쿠팡납품은 아직 룰 없음 → 0원 + 노란 칸 (경문 자료로 직접)')] });

  /* 디에이치 (2026-10-03): 솔루션비용 50,000(VAT 별도) 매달 고정 — 판매(박스앤캔 초콜릿·제주맥주) 주문이 없으면 솔루션비용만.
     이벗 판매처에 위탁 판매(박스앤캔·제주·초콜릿…디에이치/DH) 주문이 보이면 특이사항(룰 정해야 함) — 고객사 DH인터내셔널_부천 본 물량(판매처 DH인터내셔널 등)은 이 정산과 무관 */
  E['디에이치'] = { items: { 8: 'fixed', 12: 'auto', 13: 'auto', 14: 'auto' }, sheets: { '박스앤캔초콜릿판매내역': 'skip', '제주맥주판매내역': 'skip' }, verified: { 8: true }, opt: {},
    ruleList: [R('솔루션비용(이벗) 50,000 VAT 별도 매달 고정'), R('박스앤캔 초콜릿판매·제주맥주판매·제주맥주 배송비 = 주문이 없으면 0 — 이벗 판매처에 디에이치/DH 주문이 있으면 특이사항(룰 필요)')],
    afterBuild: function(wb, ctx){
      var st = ctx.st, log = ctx.log;
      [12, 13, 14].forEach(function(r){ var g = st.getCell('G' + r); if (txt(st.getCell('B' + r).value)) g.value = 0; if (r === 12) st.getCell('F' + r).value = 0; });
      ['박스앤캔초콜릿판매내역', '제주맥주판매내역'].forEach(function(n){ var ws = wb.getWorksheet(n); if (!ws) return; for (var r = 2; r <= ws.rowCount; r++) ws.getRow(r).eachCell(function(c, k){ if (k <= 33) c.value = null; }); });
      return readOrders(ctx, /^(박스앤캔|제주|초콜릿).*(디에이치|DH)/i).then(function(D){
        var n = D ? D.rows.length : 0;
        if (!D) log.push(['확인 필요', '파일함에 이벗 전체주문목록이 없어 디에이치 주문을 확인하지 못했습니다']);
        else if (n) log.push(['특이사항', '이벗 판매처에 디에이치/DH 주문 ' + n + '줄이 있습니다 — 청구 룰이 아직 없어 0원, 대화창에서 알려 주세요']);
        log.push(['자동 적용', '솔루션비용 50,000 (VAT 별도) · 판매 0원' + (n ? '' : ' (이번 달 디에이치 판매 주문 없음)') + ' → 포함가 55,000']);
      });
    } };
})();
