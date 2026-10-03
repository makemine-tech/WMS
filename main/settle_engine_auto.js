/* ============================================================
   정산관리 — 자동(범용) 엔진 · 2026-10-03 대표님 「과거 내역과 비교해서 일단 전부 먼저 만들고, 내가 분석해서 맞춰 나가겠다」
   업체 전용 엔진이 없는 업체는 모두 이걸로 초안을 만든다 (settle_vendor.js engineOf 의 기본값).
   지난달 정산서(표본)의 데이터 시트 종류를 보고, 지난달 줄에서 '이 업체를 고르는 값'을 배워 이번 달 원본에서 같은 줄만 골라 채움:
     · 이벗 택배비 리스트(택배크기)  ← 지난달 시트의 출력양식·판매처명 → 거래명세표 택배발송 극소·소·중·대 건수, 추가운임 3,000/5,000 건수
                                     파일이 아직 없으면 시트 비우고 건수 0 + 노란 칸
     · 이벗 전체주문목록              ← 지난달 시트의 판매처(없으면 고객사) 값
     · 보관비(보관일·입고·출고·보관파렛) ← 지난달 마지막 날 보관파렛 + 입출고 화물관리 그 달 입고·출고
     · 쿠팡 발주서                    ← 파일함에서 파일 이름에 업체 이름이 든 쿠팡 발주서(없으면 비우고 확인 필요)
     · 박스앤캔 택배비·반품           ← 아직 룰 없음: 파일이 없으면 비우고, 있으면 지난달 그대로 + 확인 필요
     · 재고표(이벗 재고·제주 재고)     ← 같은 종류 파일이 있으면 통째로
     · 화물 청구서 시트는 공통 처리(청구서 Sheet1 그 업체 건)가 이미 함
   표본 시트를 새로 쓸 땐 settle_build.js replaceSheet(합계 줄 옮기고 거래명세표 참조까지 고침)를 씀.
   하나라도 못 채우면 「확인 필요」, 추정했으면 「특이사항」 — 대표님이 보고 룰을 정하면 업체 전용으로 옮김
============================================================ */
(function(){
  'use strict';
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } }, NOFILL = { type: 'pattern', pattern: 'none' };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }
  function core(n){ return String(n || '').replace(/^메이크마인디자인_/, '').replace(/_(당월분|계산서미발행|\d.*)$/, '').replace(/__.*$/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ''); }

  /* 시트 제목줄·지난달 줄 읽기 */
  function tplRows(ws){
    var H = tplHeaderRow(ws), heads = [], rows = [];
    ws.getRow(H).eachCell(function(c, n){ heads[n] = ns(c.value); });
    ws.eachRow(function(row, r){ if (r <= H) return; var o = {}; heads.forEach(function(h, n){ if (h) o[h] = ns(row.getCell(n).value); }); rows.push(o); });
    return { H: H, heads: heads, rows: rows };
  }
  function learn(T, cols){ var s = {}; T.rows.forEach(function(o){ cols.forEach(function(c){ if (o[c] && !/^(합계|총합계|소계)$/.test(o[c])) s[c + '\u0001' + o[c]] = 1; }); }); return s; }
  function readAll(ctx, type, nameRe){
    var box = ctx.BOX || {}, ids = Object.keys(box).filter(function(id){ return box[id].type === type && (!nameRe || nameRe.test(box[id].name)); });
    return ids.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push({ id: id, name: box[id].name, wb: x }); return acc; }); }); }, Promise.resolve([]));
  }
  function aoaOf(x, need){   /* 제목줄(need 글자가 있는 줄) 기준 [heads, rows] */
    var best = null;
    x.SheetNames.forEach(function(n){ var a = XLSX.utils.sheet_to_json(x.Sheets[n], { header: 1, defval: '' }); for (var i = 0; i < Math.min(a.length, 12); i++){ var h = a[i].map(ns); if (need.every(function(k){ return h.indexOf(k) >= 0; })){ if (!best || a.length > best.a.length) best = { a: a, i: i }; break; } } });
    return best ? { heads: best.a[best.i].map(String), rows: best.a.slice(best.i + 1).filter(function(r){ return r.some(function(v){ return v !== ''; }); }) } : null;
  }
  function stRow(st, test){ var hit = []; st.eachRow(function(row, r){ var b = ns(row.getCell(2).value) + ns(row.getCell(3).value); if (b && test(b)) hit.push(r); }); return hit; }
  function sizeOf(label){ if (!/택배|발송|배송/.test(label)) return null; if (/극소/.test(label)) return '극소'; if (/\(소\)|소$/.test(label)) return '소'; if (/\(중\)|중$/.test(label)) return '중'; if (/\(대\d?\)|대\d?$|이형/.test(label)) return /이형/.test(label) ? null : '대'; return null; }

  var AUTO = window.SETTLE_AUTO = {
    isAuto: true, auto: {}, items: {}, sheets: {}, verified: {}, opt: {},
    ruleList: [{ d: '2026-10-03', t: '자동 초안 — 지난달 정산서 데이터 시트 종류대로 이번 달 원본에서 같은 업체 줄을 골라 채움(택배비 리스트·이벗 주문·보관비·쿠팡 발주서·재고표). 못 채운 곳은 확인 필요, 추정은 특이사항 — 대표님 확인 뒤 업체 전용 룰로' }],
    afterBuild: function(wb, ctx){
      var A = ctx.A, st = ctx.st, log = ctx.log, won = ctx.won, YM = ctx.YM, vname = (window.VW && VW.name) || '', vc = core(vname).toLowerCase();
      var Y = +YM.slice(0, 4), M = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, M, 0)).getUTCDate(), S0 = Math.round(Date.UTC(Y, M - 1, 1) / 864e5) + 25569;
      var par = (vname.match(/\(([^)]+)\)/g) || []).map(function(x){ return x.slice(1, -1).replace(/\s+/g, '').toLowerCase(); });
      var al = ((window.SETTLE_ALIASES || {})[vname] || []).map(function(x){ return String(x).replace(/\s+/g, '').toLowerCase(); });
      var keys = [vc].concat(par, al).filter(function(k){ return k.length >= 2; }), VM = window.vendorMatcher(vname);
      var hit = VM;   /* settle_engines.js vendorMatcher */
      var jobs = (A.sheets || []).filter(function(s){ return s.kind && wb.getWorksheet(s.name); });
      var sizeSet = false, sizeCnt = { 극소: 0, 소: 0, 중: 0, 대: 0 }, air = 0, isl = 0, shipSeen = false, shipMissing = false, shipMax = -1, shipSheets = [], shipBig = null;

      return jobs.reduce(function(p, s){ return p.then(function(){
        var ws = wb.getWorksheet(s.name), k = s.kind.key, T = tplRows(ws);
        /* ── 택배비 리스트 ── */
        if (k === 'ebut_shiplist'){
          shipSeen = true;
          var L = learn(T, ['출력양식', '판매처명']);
          return readAll(ctx, 'ebut_shiplist').then(function(F){
            if (!F.length){ shipMissing = true; replaceSheet(wb, s.name, T.heads.slice(1), []); log.push(['확인 필요', '시트 「' + s.name + '」 — 택배비 원본(이벗 택배비 리스트)이 아직 없어 비워 둠 (들어오면 초안 다시 받기)']); return; }
            var rows = [], heads = null;
            F.forEach(function(f){ var D = aoaOf(f.wb, ['택배크기']); if (!D) return; heads = heads || D.heads; var H = D.heads.map(ns), iO = H.indexOf('출력양식'), iS = H.indexOf('판매처명');
              /* 판매처명을 배웠으면 판매처명으로(시트마다 판매처가 나뉜 멘소래담처럼 출력양식은 공통일 수 있음), 없으면 출력양식으로 */
              var hasS = Object.keys(L).some(function(x){ return x.indexOf('판매처명\u0001') === 0; });
              D.rows.forEach(function(r){ var o = ns(r[iO]), sv = ns(r[iS]), mine = Object.keys(L).length ? (hasS ? L['판매처명\u0001' + sv] : L['출력양식\u0001' + o]) : (hit(o) || hit(sv)); if (mine) rows.push(r); }); });
            if (!heads){ log.push(['확인 필요', '시트 「' + s.name + '」 — 택배비 리스트에서 택배크기 열을 못 찾음']); return; }
            var rs = replaceSheet(wb, s.name, heads, rows), H2 = heads.map(ns), iZ = H2.indexOf('택배크기'), iA = H2.indexOf('추가운임');
            /* 택배 건수는 택배 시트가 여럿이면(토탈 + 판매처별) 가장 큰 시트 하나로만 — 겹쳐 더하지 않음 */
            if (rows.length > shipMax){ shipMax = rows.length; sizeCnt = { 극소: 0, 소: 0, 중: 0, 대: 0 }; air = 0; isl = 0;
              rows.forEach(function(r){ var z = String(r[iZ] || '').trim(); if (sizeCnt[z] != null) sizeCnt[z]++; var ad = +r[iA] || 0; if (ad === 3000) air++; else if (ad === 5000) isl++; }); }
            sizeSet = true;
            log.push(['자동 적용', '시트 「' + s.name + '」 ← 택배비 리스트 ' + rows.length + '건 (지난달 출력양식·판매처명 ' + Object.keys(L).map(function(x){ return x.split('\u0001')[1]; }).slice(0, 4).join('·') + ')']);
            rs.warn.forEach(function(w){ log.push(['확인 필요', '시트 「' + s.name + '」 — ' + w]); });
            shipSheets.push(s.name); if (rows.length >= shipMax) shipBig = s.name;
          });
        }
        /* ── 이벗 전체주문목록 ── */
        if (k === 'ebut_orders'){
          /* 지난달 줄의 고객사·판매처·매칭상품 앞부분을 모두 배워서 다 맞는 줄만 (판매처만 보면 로켓쉽먼트처럼 여러 업체가 같이 쓰는 판매처에서 섞임) */
          var pre = function(v){ return String(v || '').replace(/\s+/g, '').split(/[(\[_-]/)[0].slice(0, 8); };
          var LC = learn(T, ['고객사']), LP = {}; T.rows.forEach(function(o){ var pp = pre(o['매칭상품명']); if (pp && !/미매칭/.test(pp)) LP[pp] = 1; });
          var L2 = learn(T, ['판매처']), L3 = Object.keys(L2).length ? null : LC;
          return readAll(ctx, 'ebut_orders').then(function(F){
            if (!F.length){ log.push(['확인 필요', '시트 「' + s.name + '」 — 이벗 전체주문목록이 파일함에 없음, 지난달 그대로']); return; }
            var rows = [], heads = null, seen = {};
            F.forEach(function(f){ var D = aoaOf(f.wb, ['판매처', '송장번호']); if (!D) return; heads = heads || D.heads; var H = D.heads.map(ns), iS = H.indexOf('판매처'), iC = H.indexOf('고객사');
              var iM = H.indexOf('매칭상품명');
              D.rows.forEach(function(r){ var sv = ns(r[iS]), cv = ns(r[iC]);
                var mine = L3 == null ? L2['판매처\u0001' + sv] : (Object.keys(L3).length ? L3['고객사\u0001' + cv] : (hit(sv) || hit(cv)));
                if (mine && L3 == null && Object.keys(LC).length && !LC['고객사\u0001' + cv]) mine = false;
                if (mine && Object.keys(LP).length && iM >= 0 && !LP[pre(r[iM])]) mine = false;
                if (!mine) return; var kk = window.orderKey(H, r); if (seen[kk]) return; seen[kk] = 1; rows.push(r); }); });
            if (!heads) return;
            var rs = replaceSheet(wb, s.name, heads, rows);
            log.push([rows.length ? '자동 적용' : '특이사항', '시트 「' + s.name + '」 ← 이벗 주문 ' + rows.length + '줄 (지난달 ' + (L3 == null ? '판매처 ' + Object.keys(L2).map(function(x){ return x.split('\u0001')[1]; }).slice(0, 4).join('·') : '고객사 기준') + (Object.keys(LP).length ? ' · 상품 ' + Object.keys(LP).slice(0, 4).join('·') : '') + ')' + (rows.length ? '' : ' — 이번 달 0줄')]);
            if (rows.length) log.push(['특이사항', '시트 「' + s.name + '」 — 오른쪽 계산 열(공급가 등)은 지난달 수식이 줄 수만큼 따라오지 않을 수 있음, 금액 확인']);
            rs.warn.forEach(function(w){ log.push(['확인 필요', '시트 「' + s.name + '」 — ' + w]); });
          });
        }
        /* ── 보관비 (보관일·입고·출고·보관파렛 형식) ── */
        if (k === 'cargo_store'){
          var hd = T.heads, cD = hd.indexOf('보관파렛'), cI = hd.indexOf('입고파렛'), cO = hd.indexOf('출고파렛'), cA = hd.indexOf('보관일');
          if (cD < 0 || cI < 0 || cO < 0){ log.push(['확인 필요', '시트 「' + s.name + '」 — 보관비 형식이 달라 지난달 그대로 (보관일·입고파렛·출고파렛·보관파렛 아님)']); return; }
          var L4 = function(n){ return ws.getColumn(n).letter; }, sumR = 0, start = 0;
          ws.eachRow(function(row, r){ var d = row.getCell(cD).value; if (!sumR && r > T.H && d && typeof d === 'object' && /SUM\(/i.test(d.formula || '')) sumR = r; });
          if (!sumR){ log.push(['확인 필요', '시트 「' + s.name + '」 — 합계 줄을 못 찾아 지난달 그대로']); return; }
          for (var r0 = T.H + 1; r0 < sumR; r0++){ var a = ws.getRow(r0).getCell(cA > 0 ? cA : 1).value, dv = ws.getRow(r0).getCell(cD).value; if (a != null && a !== '' && dv != null && dv !== '' && isFinite(+txt(dv))) start = +txt(dv); }
          var cin = {}, cout = {}, n = 0;
          (ctx.CARGO || []).forEach(function(x){ if (!x || !x.date || (x.kind !== 'in' && x.kind !== 'out') || !hit(x.vendor)) return; var d = Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569; if (d < S0 || d >= S0 + ND) return;
            var pl = (+x.aj || 0) + (+x.etc || 0); n++; if (x.kind === 'in') cin[d] = (cin[d] || 0) + pl; else cout[d] = (cout[d] || 0) + pl; });
          var cur = start, tot = 0, first = T.H + 1;
          for (var i = 0; i < ND && first + i < sumR; i++){ var r = first + i, dd = S0 + i; cur += (cin[dd] || 0) - (cout[dd] || 0); tot += cur;
            if (cA > 0){ ws.getRow(r).getCell(cA).value = dd; ws.getRow(r).getCell(cA).numFmt = 'yyyy-mm-dd'; }
            ws.getRow(r).getCell(cI).value = cin[dd] || 0; ws.getRow(r).getCell(cO).value = cout[dd] || 0;
            ws.getRow(r).getCell(cD).value = { formula: (i === 0 ? String(start) : L4(cD) + (r - 1)) + '+' + L4(cI) + r + '-' + L4(cO) + r, result: cur }; }
          for (var r2 = first + ND; r2 < sumR; r2++) ws.getRow(r2).eachCell(function(c){ c.value = null; });
          ws.getRow(sumR).getCell(cD).value = { formula: 'SUM(' + L4(cD) + first + ':' + L4(cD) + (first + ND - 1) + ')', result: tot };
          stRow(st, function(b){ return /^보관비$/.test(b); }).forEach(function(r){ var g = st.getCell('G' + r); g.value = { formula: "'" + s.name + "'!" + L4(cD) + sumR, result: tot }; g.style = Object.assign({}, g.style, { fill: NOFILL }); });
          if (cur < 0) log.push(['특이사항', '보관비 마감이 음수 ' + cur + '팔 — 입출고 기록 확인']);
          log.push(['자동 적용', '시트 「' + s.name + '」 시작 ' + start + '팔(지난달 마지막 날) · 화물관리 ' + n + '건 → 마감 ' + cur + '팔 · 파렛트×일 ' + tot]);
          if (!ctx.CARGO) log.push(['확인 필요', '입출고 화물관리 기록을 못 읽어 보관비 입고·출고 0']);
          return;
        }
        /* ── 쿠팡 발주서 ── */
        if (k === 'coupang_po'){
          return readAll(ctx, 'coupang_po').then(function(F){
            var mine = F.filter(function(f){ return hit(f.name.replace(/\.\w+$/, '')); });
            if (!mine.length){ replaceSheet(wb, s.name, T.heads.slice(1), []); log.push(['확인 필요', '시트 「' + s.name + '」 — 이번 달 ' + core(vname) + ' 쿠팡 발주서가 파일함에 없어 비워 둠' + (F.length ? ' (다른 업체 쿠팡 발주서 ' + F.length + '개는 있음)' : '')]); return; }
            var D = null; mine.forEach(function(f){ var d = aoaOf(f.wb, ['발주번호']); if (d && (!D || d.rows.length > D.rows.length)) D = d; });
            if (!D){ log.push(['확인 필요', '시트 「' + s.name + '」 — 쿠팡 발주서에서 발주번호 열을 못 찾음']); return; }
            replaceSheet(wb, s.name, D.heads, D.rows); log.push(['자동 적용', '시트 「' + s.name + '」 ← ' + mine[0].name + ' ' + D.rows.length + '줄']);
          });
        }
        /* ── 박스앤캔 택배·반품 ── */
        if (k === 'bnc_return' || k === 'bnc_courier'){
          return readAll(ctx, 'bnc_courier').then(function(F){
            if (!F.length){ replaceSheet(wb, s.name, T.heads.slice(1), []); log.push(['확인 필요', '시트 「' + s.name + '」 — 박스앤캔 택배비 파일이 아직 없어 비워 둠 (들어오면 초안 다시 받기)']);
              stRow(st, function(b){ return /반품/.test(b); }).forEach(function(r){ var g = st.getCell('G' + r); if (g.value != null && g.value !== 0){ g.value = 0; g.style = Object.assign({}, g.style, { fill: YEL }); } }); return; }
            log.push(['확인 필요', '시트 「' + s.name + '」 — 박스앤캔 파일은 있지만 이 업체 고르는 룰이 아직 없어 지난달 그대로']);
          });
        }
        /* ── 재고표 ── */
        if (k === 'ebut_stock' || k === 'jeju_stock'){
          return readAll(ctx, k).then(function(F){
            if (!F.length){ log.push(['확인 필요', '시트 「' + s.name + '」 — 이번 달 재고 파일이 없어 지난달 그대로']); return; }
            var D = null; F.forEach(function(f){ var d = aoaOf(f.wb, [T.heads.filter(Boolean)[0] || '']); if (d && (!D || d.rows.length > D.rows.length)) D = d; });
            if (!D){ log.push(['확인 필요', '시트 「' + s.name + '」 — 재고 파일 제목줄이 달라 지난달 그대로']); return; }
            replaceSheet(wb, s.name, D.heads, D.rows); log.push(['자동 적용', '시트 「' + s.name + '」 ← ' + F[0].name + ' ' + D.rows.length + '줄']);
          });
        }
        if (k === 'freight') return;   /* 공통 처리가 함 */
        log.push(['확인 필요', '시트 「' + s.name + '」 (' + s.kind.label + ') — 자동 룰 없음, 지난달 그대로']);
      }); }, Promise.resolve()).then(function(){
        /* 거래명세표 택배 건수 */
        if (!shipSeen) return;
        /* 택배비 리스트가 있으면 공통 마무리(settle_engines.js shipSheetFinish): 제주 추가운임 400 · 택배크기 노란 칸 · 거래명세표 건수 = COUNTIF 수식 (가장 큰 택배 시트 기준) */
        if (!shipMissing && shipBig) return shipSheets.reduce(function(p, n){ return p.then(function(){ return window.shipSheetFinish(wb, n, n === shipBig ? st : null, ctx); }); }, Promise.resolve());
        stRow(st, function(b){ return !!sizeOf(b); }).forEach(function(r){ var z = sizeOf(ns(st.getCell('B' + r).value) + ns(st.getCell('C' + r).value)), g = st.getCell('G' + r);
          g.value = shipMissing ? 0 : sizeCnt[z]; g.style = Object.assign({}, g.style, { fill: shipMissing ? YEL : NOFILL }); });
        stRow(st, function(b){ return /항공|제주도/.test(b); }).forEach(function(r){ var g = st.getCell('G' + r); g.value = shipMissing ? 0 : air; g.style = Object.assign({}, g.style, { fill: shipMissing ? YEL : NOFILL }); });
        stRow(st, function(b){ return /도선|섬도서/.test(b); }).forEach(function(r){ var g = st.getCell('G' + r); g.value = shipMissing ? 0 : isl; g.style = Object.assign({}, g.style, { fill: shipMissing ? YEL : NOFILL }); });
        if (sizeSet) log.push(['자동 적용', '거래명세표 택배 건수 극소 ' + sizeCnt.극소 + ' · 소 ' + sizeCnt.소 + ' · 중 ' + sizeCnt.중 + ' · 대 ' + sizeCnt.대 + (air ? ' · 항공 ' + air : '') + (isl ? ' · 도선 ' + isl : '')]);
      });
    }
  };
})();
