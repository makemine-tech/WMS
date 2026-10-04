/* ============================================================
   정산관리 — 기본 업체(택배비 + 보관비 흐름) 공통 엔진 · 2026-10-03 대표님
   「신성·심플리·트립인터·오름 등 기본 업체는 택배비·보관비 외에 큰 변수가 없다」

   택배비: 파일함 「이벗 택배비 리스트」(택배크기 포함, 늦게 들어올 수 있음)
     · 지난달 표본의 택배 시트에 있던 출력양식·판매처명으로 이 업체 줄을 골라 시트를 이번 달 줄로 새로 씀
       (지난달 줄이 없으면 업체 이름으로)
     · 거래명세표 택배발송(극소·소·중·대) = 택배크기별 건수, 항공비/제주도 = 추가운임 3,000 건수, 도선비/섬도서산간 = 추가운임 5,000 건수
     · 파일이 아직 없으면: 택배 시트 비우고 건수 0 + 노란 칸 + 확인 필요 → 파일이 들어오면 초안 다시 받기
   보관비: 지난달 보관비 시트 마지막 날 보관파렛 = 이번 달 시작, 입출고 화물관리 그 달 입고·출고(파렛트 AJ+우체국)를 날짜별로 →
     보관파렛 = 전날 + 입고 − 출고, 맨 아래 합계(파렛트×일) — 거래명세표 보관비 수량은 그 합계를 가리킴(단가는 표본 그대로)
   솔루션·사용료처럼 매달 같은 줄은 표본 그대로. 반품비는 박스앤캔 반품 원본이 들어오면 (아직 0 + 노란 칸)
   화물 흔적(청구서·입출고)은 settle_build.js traceCargo 가 따로 보여 줌
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var R = function(t){ return { d: '2026-10-03', t: t }; };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); return v == null ? '' : String(v); }
  function nsp(v){ return txt(v).replace(/\s+/g, ''); }
  function core(n){ return String(n || '').replace(/^메이크마인디자인_/, '').replace(/_(당월분|계산서미발행|_?\d.*)$/, '').replace(/__.*$/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ''); }
  function lineRow(st, re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(nsp(row.getCell(2).value))) hit = r; }); return hit; }
  function setQty(st, re, v, log, why, mark){ var r = lineRow(st, re); if (!r) return false; var c = st.getCell('G' + r); c.value = v; if (mark){ c.style = Object.assign({}, c.style, { fill: YEL }); } return true; }

  function std(cfg){
    var core = stdCore(cfg);
    /* cfg.after(wb, ctx) = 업체 전용 처리를 공통(보관비·택배비) 뒤에 (탑프레쉬 — settle_engine_top.js) */
    return { needs: cfg.needs, items: cfg.items || {}, sheets: cfg.sheets || {}, verified: cfg.verified || {}, verifiedSheets: cfg.verifiedSheets, ownSheets: cfg.ownSheets, opt: {}, ruleList: cfg.ruleList,
      afterBuild: function(wb, ctx){ return Promise.resolve(core(wb, ctx)).then(function(){ return cfg.returns && stdReturns(cfg, wb, ctx); }).then(function(){ return cfg.after && cfg.after(wb, ctx); }); } };
  }
  /* cfg.returns = { sheet: '반품비', who: /업체/ } — 박스앤캔 택배비 「반품」 시트에서 고객명이 이 업체인 줄로 시트를 새로 (합계 줄·거래명세표 참조는 replaceSheet 가 옮김) · 파일이 없으면 반품비 0 + 노란 칸 */
  function stdReturns(cfg, wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, ws = wb.getWorksheet(cfg.returns.sheet); if (!ws) return;
    var L = Object.keys(box).filter(function(id){ return box[id].type === 'bnc_courier' && !box[id].ref; }), lr = 0;
    var hasRef = (ctx.REF || []).some(function(f){ return f.use === '반품'; });
    st.eachRow(function(row, r){ if (!lr && /^반품비/.test(nsp(row.getCell(2).value))) lr = r; });
    if (!L.length && !hasRef){ if (lr){ var g = st.getCell('G' + lr); g.value = 0; g.style = Object.assign({}, g.style, { fill: YEL }); }
      log.push(['확인 필요', '박스앤캔 택배비 파일·반품 참조 파일이 아직 없어 반품비 0 (노란 칸) — 들어오면 초안 다시 받기']); return; }
    var TH = []; ws.getRow(1).eachCell(function(c, n){ TH[n - 1] = txt(c.value); }); TH = Array.prototype.slice.call(TH).map(function(h){ return h || ''; });
    var rows = [], nB = 0, iK = TH.map(nsp).indexOf('등기번호'), seen = {};
    var add = function(r){ var k = iK >= 0 ? nsp(r[iK]) : ''; if (k){ if (seen[k]) return false; seen[k] = 1; } rows.push(r); return true; };
    return L.reduce(function(p, id){ return p.then(function(acc){ return ctx.readBox(box[id]).then(function(x){ acc.push(x); return acc; }); }); }, Promise.resolve([])).then(function(F){
      F.forEach(function(x){ var w = x.Sheets['반품']; if (!w) return; var a = XLSX.utils.sheet_to_json(w, { header: 1, defval: '' }), H = (a[0] || []).map(nsp), iC = H.indexOf('고객명');
        a.slice(1).forEach(function(r){ if (cfg.returns.who.test(String(r[iC])) && add(TH.map(function(h){ var i = H.indexOf(nsp(h)); return i >= 0 ? r[i] : ''; }))) nB++; }); });
      return window.SETTLE_REF_ROWS(ctx, '반품', TH);   /* 업체 참조 파일(용도 반품) — 열 이름으로 맞춤 */
    }).then(function(R){
      var nR = 0; R.rows.forEach(function(r){ if (add(r)) nR++; });
      replaceSheet(wb, cfg.returns.sheet, TH, rows);
      if (lr && !rows.length){ var g2 = st.getCell('G' + lr); if (!(g2.value && g2.value.formula)) g2.value = 0; }
      log.push(['자동 적용', cfg.returns.sheet + ' ' + rows.length + '건 ← ' + [L.length ? '박스앤캔 반품 시트 ' + nB + '건' : '', R.files.length ? '참조 파일(' + R.files.join(', ') + ') ' + nR + '건' : ''].filter(Boolean).join(' + ')]);
      R.map.forEach(function(m){ if (/←/.test(m)) log.push(['안내', '반품 참조 열 맞춤 — ' + m + (/수량←/.test(m) ? '' : ' · 수량 = 줄마다 1(반품 1건)')]); });
      if (R.miss.length) log.push(['특이사항', '반품 참조 파일 ' + R.miss.join(', ') + ' — 열 이름이 「' + cfg.returns.sheet + '」 시트(' + TH.filter(Boolean).join('·') + ')와 맞지 않아 못 넣음, 직접 확인']);
    });
  }
  window.SETTLE_STD = std;
  function stdCore(cfg){
    return function(wb, ctx){
        var st = ctx.st, log = ctx.log, won = ctx.won, YM = ctx.YM;
        (cfg.zeroQty || []).forEach(function(re){ var r = lineRow(st, re); if (r) st.getCell('G' + r).value = 0; });
        var Y = +YM.slice(0, 4), M = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, M, 0)).getUTCDate();
        var S0 = Math.round(Date.UTC(Y, M - 1, 1) / 864e5) + 25569, vname = cfg.name, vc = core(vname).toLowerCase();
        var keys = [vc].concat((cfg.alias || []).map(function(x){ return String(x).replace(/\s+/g, '').toLowerCase(); })).filter(function(k){ return k.length >= 2; });
        var hit = window.vendorMatcher(cfg.name, cfg.alias);   /* settle_engines.js */

        /* ── 보관비 ── */
        (function(){
          var ws = wb.getWorksheet(cfg.storeSheet || '보관비'); if (!ws){ log.push(['확인 필요', '보관비 시트가 없습니다']); return; }
          var sumR = 0, lastD = 0, start = 0;
          ws.eachRow(function(row, r){ var d = row.getCell(4).value; if (d && typeof d === 'object' && /SUM\(/i.test(d.formula || '')) { if (!sumR) sumR = r; } });
          if (!sumR){ log.push(['확인 필요', '보관비 시트 합계 줄(SUM)을 못 찾음 — 지난달 그대로']); return; }
          for (var r0 = 2; r0 < sumR; r0++){ var a = ws.getCell('A' + r0).value, dv = ws.getCell('D' + r0).value; if (a != null && a !== '' && dv != null && dv !== ''){ lastD = r0; start = +txt(dv) || 0; } }
          var cin = {}, cout = {}, n = 0, C = ctx.CARGO || [];
          /* 화물관리 기록: 입고·출고 파렛트는 입고파렛·출고파렛에, 모든 기록(입고·출고·택배출고·반품·기타)의 내용은 그날 비고 칸에 (대표님 2026-10-03 — 신성애드 등) */
          var note = {}, KN = { in: '입고', out: '출고', parcel: '택배출고', ret: '반품 양품화', etc: '기타' };
          C.forEach(function(x){ if (!x || !x.date || !hit(x.vendor)) return;
            var d = Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569; if (d < S0 || d >= S0 + ND) return; var p = (+x.aj || 0) + (+x.etc || 0); n++;
            (note[d] = note[d] || []).push((KN[x.kind] || x.kind || '') + (p ? ' ' + p + '팔' : '') + (+x.box ? ' ' + x.box + '박스' : '') + ((x.memo || x.note) ? ' · ' + (x.memo || x.note) : ''));
            if (x.kind === 'in') cin[d] = (cin[d] || 0) + p; else if (x.kind === 'out') cout[d] = (cout[d] || 0) + p; });
          if (n && !txt(ws.getCell('E1').value)){ ws.getCell('E1').value = '비고'; ws.getCell('E1').style = JSON.parse(JSON.stringify(ws.getCell('D1').style || {})); ws.getColumn(5).width = Math.max(ws.getColumn(5).width || 0, 40); }
          if (!ctx.CARGO) log.push(['확인 필요', '입출고 화물관리 기록을 못 읽어 보관비 입고·출고가 0 — 화면에서 화물관리 연결 확인']);
          var cur = start, tot = 0, last = Math.min(sumR - 1, 1 + ND);
          for (var i = 0; i < ND && 2 + i < sumR; i++){ var r = 2 + i, dd = S0 + i, ci = cin[dd] || 0, co = cout[dd] || 0; cur = cur + ci - co; tot += cur;
            ws.getCell('A' + r).value = dd; ws.getCell('A' + r).numFmt = 'yyyy-mm-dd'; ws.getCell('B' + r).value = ci; ws.getCell('C' + r).value = co;
            ws.getCell('D' + r).value = { formula: (i === 0 ? start : 'D' + (r - 1)) + '+B' + r + '-C' + r, result: cur };
            ws.getCell('E' + r).value = note[dd] ? note[dd].join(' / ') : null; }
          for (var r2 = 2 + ND; r2 < sumR; r2++) ['A', 'B', 'C', 'D', 'E'].forEach(function(c){ ws.getCell(c + r2).value = null; });
          var sf = ws.getCell('D' + sumR).value; ws.getCell('D' + sumR).value = { formula: 'SUM(D2:D' + last + ')', result: tot };
          var sr = lineRow(st, /^보관비$/); if (sr){ var g = st.getCell('G' + sr); g.value = { formula: "'" + ws.name + "'!D" + sumR, result: tot }; }
          var price = sr ? +txt(st.getCell('H' + sr).value) || 0 : 0;
          if (cur < 0) log.push(['특이사항', '보관비 마감 파렛트가 음수(' + cur + ') — 시작 ' + start + ' · 입출고 기록 확인']);
          log.push(['자동 적용', '보관비 시작 ' + start + '팔(지난달 마지막 날) + 입고 ' + Object.keys(cin).reduce(function(s, k){ return s + cin[k]; }, 0) + ' − 출고 ' + Object.keys(cout).reduce(function(s, k){ return s + cout[k]; }, 0) + ' (화물관리 ' + n + '건) → 마감 ' + cur + '팔 · 파렛트×일 ' + tot + (price ? ' × ' + won(price) + ' = ' + won(tot * price) : '')]);
        })();

        /* ── 택배비 ── */
        var box = ctx.BOX || {}, ids = Object.keys(box).filter(function(id){ return box[id].type === 'ebut_shiplist'; });
        var ss = wb.getWorksheet(cfg.shipSheet); if (!ss){ log.push(['확인 필요', '택배 시트 「' + cfg.shipSheet + '」 가 없습니다']); return; }
        var th = []; ss.getRow(1).eachCell(function(c, n){ th[n] = nsp(c.value); });
        var col = function(nm){ return th.indexOf(nm); };
        /* 지난달 줄에서 출력양식·판매처명 배우기 */
        var learnO = {}, learnS = {}; ss.eachRow(function(row, r1){ if (r1 < 2) return; var o = nsp(row.getCell(col('출력양식')).value), s2 = nsp(row.getCell(col('판매처명')).value); if (o) learnO[o] = 1; if (s2) learnS[s2] = 1; });   /* 내용 있는 줄만 (시트 범위가 104만 줄로 잡힌 표본이 있음) */
        var clearSheet = function(){ ss.eachRow(function(row, r){ if (r >= 2) row.eachCell(function(c){ c.value = null; }); }); };
        var SIZES = [['극소', /^택배발송\(극소\)$/], ['소', /^택배발송\(소\)$/], ['중', /^택배발송\(중\)$/], ['대', /^택배발송\(대\)$/]];
        if (!ids.length){
          clearSheet();
          SIZES.forEach(function(s){ setQty(st, s[1], 0, log, s[0], true); }); setQty(st, /^(항공비|제주도)$/, 0, log, '항공', true); setQty(st, /^(도선비|섬도서산간)$/, 0, log, '도선', true);
          log.push(['확인 필요', '택배비 원본(이벗 택배비 리스트)이 아직 파일함에 없습니다 — 택배 건수 0으로 비워 둠(노란 칸), 들어오면 초안을 다시 받으세요']);
          return;
        }
        var rows = [], seen = {}, dropMiss = 0;
        return ids.reduce(function(p, id){ return p.then(function(){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(xwb){
          var a = XLSX.utils.sheet_to_json(xwb.Sheets[xwb.SheetNames[0]], { header: 1, defval: '' }), hi = 0;
          for (var i = 0; i < Math.min(a.length, 10); i++) if (a[i].map(nsp).indexOf('택배크기') >= 0){ hi = i; break; }
          var H = (a[hi] || []).map(nsp), iO = H.indexOf('출력양식'), iS = H.indexOf('판매처명');
          var useLearn = Object.keys(learnO).length || Object.keys(learnS).length;
          a.slice(hi + 1).forEach(function(r){ var o = nsp(r[iO]), s = nsp(r[iS]);
            var mine = useLearn ? (learnO[o] || learnS[s]) : (hit(o) || hit(s)); if (!mine) return;
            if (/누락오배송/.test(o) && !learnO[o]){ dropMiss++; return; }   /* 누락오배송 = 우리 쪽 재발송, 청구 안 함 (지난달 시트에 있던 출력양식이면 그대로) — 2026-10-04 탑프레쉬 */
            var k = r.join('\u0001'); if (seen[k]) return; seen[k] = 1;
            rows.push(th.map(function(h){ var j = H.indexOf(h); return j < 0 ? (h === '건수' ? 1 : null) : r[j]; })); });
        }); }); }, Promise.resolve()).then(function(){
          clearSheet();
          var iSz = col('택배크기'), iAdd = col('추가운임'), cnt = { 극소: 0, 소: 0, 중: 0, 대: 0 }, air = 0, isl = 0, other = 0;
          /* sizeAll: 택배크기를 모두 이 크기로 (오름코스메틱 = 극소) · bigQty: 매칭총수량이 이 이상인 송장은 노란 표시 + 특이사항 → 대표님이 크기 확인 */
          var iQ = col('매칭총수량') > 0 ? col('매칭총수량') : col('수량'), big = [];
          if (cfg.sizeAll && iSz > 0) rows.forEach(function(r){ r[iSz] = cfg.sizeAll; });
          /* sizeByQty = [[최대수량, 크기], …] — 원본 크기가 비어 있으면 매칭총수량으로 (제이피코프: 1~5 극소 · 6~16 소 · 17~48 중 · 그 이상 대) */
          if (cfg.sizeByQty && iSz > 0 && iQ > 0) rows.forEach(function(r){ if (String(r[iSz] == null ? '' : r[iSz]).trim()) return; var q = +r[iQ] || 0; if (!q) return;
            for (var k = 0; k < cfg.sizeByQty.length; k++) if (q <= cfg.sizeByQty[k][0]){ r[iSz] = cfg.sizeByQty[k][1]; return; } });
          if (cfg.sizeDefault && iSz > 0) rows.forEach(function(r){ if (!String(r[iSz] == null ? '' : r[iSz]).trim()) r[iSz] = cfg.sizeDefault; });   /* 원본 크기가 비어 있을 때만 (탑프레쉬) */
          var iM = col('매칭정보');   /* 미매칭(추가송장 등)은 상품수를 몰라 같이 표시 — 8월 오름 「추가송장」 = 중 · bigRe = 크기가 커지는 제품(탑프레쉬 그린박스) */
          if (cfg.bigQty && iQ > 0) rows.forEach(function(r, i){ var m = iM > 0 ? String(r[iM]) : ''; if ((+r[iQ] || 0) >= cfg.bigQty || /미매칭/.test(m) || (cfg.bigRe && cfg.bigRe.test(m))) big.push(i); });
          rows.forEach(function(r, i){ var row = ss.getRow(2 + i); r.forEach(function(v, n){ if (n) row.getCell(n).value = v === '' ? null : v; }); });
          rows.forEach(function(r){ var z = String(r[iSz] || '').trim(); if (cnt[z] != null) cnt[z]++; else other++; var ad = +r[iAdd] || 0; if (ad === 3000) air++; else if (ad === 5000) isl++; });
          SIZES.forEach(function(s){ setQty(st, s[1], cnt[s[0]], log, s[0]); });
          setQty(st, /^(항공비|제주도)$/, air, log, '항공'); setQty(st, /^(도선비|섬도서산간)$/, isl, log, '도선');
          if (dropMiss) log.push(['특이사항', '출력양식 「누락오배송」 ' + dropMiss + '건은 청구에서 뺌 (재발송)']);
          if (other) log.push(['특이사항', '택배크기가 극소·소·중·대가 아닌 줄 ' + other + '건 — 택배 시트 확인']);
          if (!rows.length) log.push(['특이사항', '이번 달 택배비 리스트에 이 업체 줄이 없습니다 (출력양식 ' + Object.keys(learnO).join('·') + ')']);
          log.push(['자동 적용', cfg.shipSheet + ' ← 이벗 택배비 리스트 ' + rows.length + '건 · 극소 ' + cnt.극소 + ' · 소 ' + cnt.소 + ' · 중 ' + cnt.중 + ' · 대 ' + cnt.대 + (air ? ' · 항공 ' + air : '') + (isl ? ' · 도선 ' + isl : '')]);
          return window.shipSheetFinish(wb, cfg.shipSheet, st, ctx, { noSizeYellow: !!(cfg.sizeAll || cfg.sizeDefault || cfg.sizeByQty) }).then(function(){   /* 제주 추가운임 400 · 택배크기 노란 칸 · 건수 COUNTIF 수식 */
            if (!big.length) return;
            var iV = col('송장번호');
            big.forEach(function(i){ var row = ss.getRow(2 + i); [iSz, iQ].forEach(function(n){ var c = row.getCell(n); c.style = Object.assign({}, c.style, { fill: YEL }); }); });
            log.push(['특이사항', '상품 ' + cfg.bigQty + '개 이상·미매칭' + (cfg.bigRe ? '·' + (cfg.bigName || '큰 제품') : '') + ' 송장 ' + big.length + '건 — ' + cfg.shipSheet + ' 시트 노란 줄, 택배크기(지금 ' + (cfg.sizeAll || (cfg.sizeDefault ? '원본, 없으면 ' + cfg.sizeDefault : '원본')) + ') 확인·조정: '
              + big.map(function(i){ return (rows[i][iV] || '') + '(' + (iM > 0 && /미매칭/.test(String(rows[i][iM])) ? '미매칭' : rows[i][iQ] + '개') + ')'; }).join(', ')]);
          });
        });
    };
  }

  var COMMON = window.SETTLE_STD_RULES = [R('보관비 = 지난달 마지막 날 보관파렛에서 시작, 입출고 화물관리 그 달 입고·출고(파렛트)를 날짜별로 → 파렛트×일 합계가 거래명세표 보관비 수량 (단가는 지난달 그대로)'),
    R('택배비 = 이벗 택배비 리스트에서 지난달 택배 시트의 출력양식·판매처명 줄 → 택배크기별 건수(극소·소·중·대) · 추가운임 3,000 = 항공/제주 · 5,000 = 도선/섬. 파일이 아직 없으면 0 + 노란 칸'),
    R('솔루션비용 등 매달 같은 줄은 지난달 그대로 · 화물 청구서·입출고의 이 업체 흔적은 점검_화물흔적 시트로')];
  E['심플리뷰티풀'] = std({ name: '심플리뷰티풀', shipSheet: '배송비', sheets: { '배송비': 'skip', '보관비': 'skip' },
    /* 2026-10-03 대표님 9월 확정본과 칸 단위 대조: 다른 곳은 솔루션비용 수량(1 → 0)뿐 → 룰로. 택배·보관비 줄 검증됨 */
    items: { 8: 'auto', 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto', 13: 'auto', 19: 'auto', 20: 'auto' }, verified: { 8: true, 9: true, 10: true, 11: true, 12: true, 13: true, 19: true, 20: true },
    zeroQty: [/^솔루션비용$/],
    ruleList: [R('보관비만 책정 (택배 건이 생기면 택배비도)'), R('솔루션비용 수량 0 (청구 안 함) — 9월 확정본 기준')].concat(COMMON) });
  E['신성애드'] = std({ name: '신성애드', shipSheet: '택배비', sheets: { '택배비': 'skip', '보관비': 'skip' }, items: {}, ruleList: COMMON });
  E['트립인터__0000원'] = std({ name: '트립인터', alias: ['하나유통', '트립'], shipSheet: '택배비', sheets: { '택배비': 'skip', '보관비': 'skip' }, items: {}, ruleList: COMMON });
  /* 2026-10-04 대표님: 특이사항·복잡한 부분 없음, 택배크기는 대부분 극소 — 상품 20개 이상 송장은 표시해서 초안에서 크기 확인 */
  E['오름코스메틱'] = std({ name: '오름코스메틱', alias: ['오름'], shipSheet: '배송비', sheets: { '배송비': 'skip', '보관비': 'skip', '반품': 'skip' }, sizeAll: '극소', bigQty: 20,
    /* ✅ 7월 확정본 + 8월 원본(8월 배송비로 만든 리스트)으로 8월 재현: 항공 1 · 보관비 93 · 솔루션 1 일치, 노란 표시 4건 = 8월에 소·중으로 고친 송장 4건 (2026-10-04) */
    items: { 8: 'auto', 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto', 19: 'fixed', 20: 'auto' }, verified: { 12: true, 20: true },
    ruleList: [{ d: '2026-10-04', t: '택배크기 = 모두 극소, 상품(매칭총수량) 20개 이상·미매칭(추가송장) 송장은 노란 표시 + 특이사항 → 초안에서 크기 확인·조정' }].concat(COMMON) });
})();
/* 제이피코프 (2026-10-04 · 2025-09 ~ 2026-08 정산서 12개월 분석) — 택배크기는 방탄커피 개수(매칭총수량)로:
   1~5 극소 · 6~16 소 · 17~48 중 · 그 이상 대 (16개는 소 12건·중 3건이라 16개 이상은 노란 표시로 확인) · 반품비 = 박스앤캔 반품 시트 */
(function(){
  var E = window.SETTLE_ENGINES, R = function(t){ return { d: '2026-10-04', t: t }; };
  E['제이피코프'] = window.SETTLE_STD({ name: '제이피코프', shipSheet: '배송비', needs: ['ebut_shiplist', 'ebut_orders', 'bnc_courier'],
    sheets: { '배송비': 'skip', '보관비': 'skip' }, ownSheets: /^(반품비|쿠팡입고내역)$/,
    sizeByQty: [[5, '극소'], [16, '소'], [48, '중'], [1e9, '대']], bigQty: 16,
    returns: { sheet: '반품비', who: /제이피코프/ },
    items: { 16: 'auto', 17: 'auto', 18: 'auto', 19: 'auto', 20: 'auto', 22: 'auto', 24: 'auto', 26: 'auto', 13: 'fixed', 28: 'fixed' },
    /* ✅ 7월 확정본 + 8월 원본(크기 비운 8월 배송비)으로 8월 재현: 극소 349 · 소 85 · 중 1 · 반품 4 · 포장작업비 439 · 보관비 124 → 소계 1,671,800 = 8월 확정본 */
    verified: { 16: true, 17: true, 18: true, 19: true, 20: true, 22: true, 24: true, 26: true }, verifiedSheets: /^(배송비|반품비)$/,
    ruleList: [R('택배크기 = 원본이 비어 있으면 매칭총수량(방탄커피 개수)으로 1~5 극소 · 6~16 소 · 17~48 중 · 그 이상 대, 16개 이상·미매칭은 노란 표시'),
      R('반품비 = 박스앤캔 반품 시트에서 고객명 제이피코프 줄 · 포장작업비 = 택배 건수 + 반품 (지난달 수식 그대로) · 솔루션 70,000 매달 그대로')].concat(window.SETTLE_STD_RULES || []) });
})();
