/* ============================================================
   정산관리 — 스타인터내셔널(온라인세일즈) (2026-10-05 대표님 룰 · 2026-05 ~ 08 확정본 분석)
     배송비 시트  = 이벗 택배비 리스트(판매처 스타인터내셔널(KP))의 송장마다 한 줄
                    택배크기 = 지난 데이터와 같게 ① 같은 상품·사이즈·수량 구성 → 그때 크기 ② 같은 상품(사이즈 무관)·수량 → 그때 크기
                               ③ 분류(신발·의류·모자…)별 수량 → 가장 많던 크기(같으면 큰 쪽) ④ 처음 보는 분류 = 1개 극소 · 2~3 소 · 4~6 중 · 7+ 대
                               (의류는 수량이 많아도 크기가 안 오르는 경우가 있어 ③이 그대로 반영됨 · 백테스트 8월 95.4%, 금액 −9,500)
                               기준 = settle_starol_size.js(5~8월) + 표본(지난달 확정본) 배송비에서 새로 배움
                    추가운임 = 주문목록에서 같은 송장 주소가 제주면 400 (항공비)
     반품비 시트  = 박스앤캔 택배비 「반품」 중 스타인터내셔널 — 🔁 반품비 역추적 기록이 있으면 원송장 주인이 스타인 것 (고객명이 스타여도 원송장 주인이 다른 업체면 뺌)
                    박스앤캔 택배비가 아직 없으면 비워 둠
     기타 시트    = 특이사항 있을 때만 직접 — 비워 둠
     입고작업 시트 = 이벗 입고 목록(고객사 스타인터내셔널) → MMDD_세일즈_입고작업
     거래명세표   = 오른쪽 피벗 4개를 수식 표로 바꿈(배송비·반품비·입고작업 시트를 COUNTIFS/SUMIFS 로 바로 셈) → 명세표 수량 칸이 그 표를 가리킴 (연산이 살아 있음)
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var R = function(t){ return { d: '2026-10-05', t: t }; };
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  var HEADF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }, TITLEF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  var THIN = { style: 'thin', color: { argb: 'FF808080' } }, BOX4 = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  var SZ = ['극소', '소', '중', '대'], RK = { 극소: 0, 소: 1, 중: 2, 대: 3 };
  var SELLER = /스타인터내셔널/;
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); if (v && typeof v === 'object' && v.formula) return ''; return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }

  /* ── 택배 크기 ── */
  function cat(s){ var m = String(s).match(/^[^_]*_([^_]*)_/); return m ? m[1] : '?'; }
  function prod(s){ return String(s).replace(/-\d+$/, '').replace(/-[^-]*$/, ''); }
  function parse(info, tot0){
    var items = String(info || '').split('$').filter(Boolean).map(function(it){ return { it: it.replace(/-\d+$/, ''), q: +((it.match(/-(\d+)$/) || [])[1]) || 1, c: cat(it), p: prod(it) }; });
    var tot = items.reduce(function(s, x){ return s + x.q; }, 0) || +tot0 || 0, cc = {};
    items.forEach(function(x){ cc[x.c] = (cc[x.c] || 0) + x.q; });
    return { sig: items.map(function(x){ return x.it + 'x' + x.q; }).sort().join(','), psig: items.map(function(x){ return x.p + 'x' + x.q; }).sort().join(','),
      csig: Object.keys(cc).sort().map(function(k){ return k + cc[k]; }).join('+'), tot: tot };
  }
  function topOf(c){ return Object.keys(c).sort(function(a, b){ return c[b] - c[a] || RK[b] - RK[a]; })[0]; }
  function fallback(t){ return t <= 1 ? '극소' : t <= 3 ? '소' : t <= 6 ? '중' : '대'; }
  function predict(S, o){
    if (S.ex[o.sig]) return [S.ex[o.sig], '같은 구성'];
    if (S.px[o.psig]) return [S.px[o.psig], '같은 상품'];
    if (S.cx[o.csig]) return [topOf(S.cx[o.csig]), '분류 수량'];
    return [fallback(o.tot), '처음 보는 분류'];
  }

  function after(wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, YM = ctx.YM, won = ctx.won;
    var Y = +YM.slice(0, 4), Mo = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, Mo, 0)).getUTCDate(), MMDD = String(Mo).padStart(2, '0') + String(ND).padStart(2, '0');
    var ids = function(t){ return Object.keys(box).filter(function(id){ return box[id].type === t; }); };
    var read = function(L){ return L.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push({ name: box[id].name, wb: x }); return acc; }); }); }, Promise.resolve([])); };
    var tables = function(x, need, sheetRe){ var out = []; x.SheetNames.forEach(function(n){ if (sheetRe && !sheetRe.test(n)) return; var a = XLSX.utils.sheet_to_json(x.Sheets[n], { header: 1, defval: '', raw: true });
      for (var i = 0; i < Math.min(a.length, 12); i++){ var h = a[i].map(ns); if (need.every(function(k){ return h.indexOf(k) >= 0; })){ out.push({ H: h, rows: a.slice(i + 1).filter(function(r){ return r.some(function(v){ return v !== '' && v != null; }); }) }); break; } } }); return out; };
    var heads = function(ws){ var H = []; ws.getRow(1).eachCell({ includeEmpty: true }, function(c, n){ H[n - 1] = ns(c.value); }); for (var i = 0; i < H.length; i++) if (H[i] == null) H[i] = ''; return H; };
    var colL = function(ws, h){ var n = 0; ws.getRow(1).eachCell(function(c, k){ if (!n && ns(c.value) === h) n = k; }); return n ? ws.getColumn(n).letter : null; };

    /* 크기 기준 = 5~8월 + 표본(지난달 확정본) 배송비 */
    var B = window.STAROL_SIZE || { ex: {}, px: {}, cx: {} }, S = { ex: Object.assign({}, B.ex), px: Object.assign({}, B.px), cx: JSON.parse(JSON.stringify(B.cx || {})) };
    var tws = wb.getWorksheet('배송비'), learned = 0;
    if (tws){ var th = heads(tws), iI = th.indexOf('매칭정보'), iZ = th.indexOf('택배크기'), iT = th.indexOf('매칭총수량');
      tws.eachRow(function(row, r){ if (r === 1) return; var z = ns(row.getCell(iZ + 1).value); if (RK[z] == null) return;
        var o = parse(txt(row.getCell(iI + 1).value), txt(row.getCell(iT + 1).value)); if (!o.sig) return;
        S.ex[o.sig] = z; S.px[o.psig] = z; (S.cx[o.csig] = S.cx[o.csig] || {})[z] = (S.cx[o.csig][z] || 0) + 1; learned++; }); }

    var ship = [], jeju = {}, ret = [], inRows = [], nBnc = 0, inFiles = [];
    return read(ids('ebut_shiplist')).then(function(F){
      F.forEach(function(f){ tables(f.wb, ['송장번호', '택배크기', '판매처명']).forEach(function(T){ T.rows.forEach(function(r){
        var g = function(k){ var i = T.H.indexOf(k); return i >= 0 ? r[i] : ''; }; if (!SELLER.test(String(g('판매처명')) + String(g('출력양식')))) return; ship.push({ H: T.H, r: r, f: f.name }); }); }); });
      return read(ids('ebut_orders'));
    }).then(function(F){
      F.forEach(function(f){ tables(f.wb, ['송장번호', '주소']).forEach(function(T){ var iN = T.H.indexOf('송장번호'), iA = T.H.indexOf('주소');
        T.rows.forEach(function(r){ var v = String(r[iN] || '').trim(); if (v && /^\s*제주/.test(String(r[iA] || ''))) jeju[v] = 1; }); }); });
      return read(ids('bnc_courier'));
    }).then(function(F){
      nBnc = F.length;
      F.forEach(function(f){ tables(f.wb, ['등기번호', '고객명'], /반품/).forEach(function(T){ T.rows.forEach(function(r){ ret.push({ H: T.H, r: r }); }); }); });
      return read(ids('ebut_instock'));
    }).then(function(F){
      F.forEach(function(f){ tables(f.wb, ['입고일', '가용입고']).forEach(function(T){ var iC = T.H.indexOf('고객사명') >= 0 ? T.H.indexOf('고객사명') : T.H.indexOf('고객사');
        inFiles.push(f.name); T.rows.forEach(function(r){ if (iC < 0 || SELLER.test(String(r[iC]))) inRows.push({ H: T.H, r: r }); }); }); });

      /* 1) 배송비 */
      var TH = tws ? heads(tws) : [], unseen = {}, seen = {}, rows = [], how = {}, cnt = { 극소: 0, 소: 0, 중: 0, 대: 0 }, nJ = 0, sumQ = 0;
      ship.forEach(function(s){ var g = function(k){ var i = s.H.indexOf(k); return i >= 0 ? s.r[i] : ''; }, inv = String(g('송장번호')).trim(); if (!inv || seen[inv]) return; seen[inv] = 1;
        var o = parse(g('매칭정보'), g('매칭총수량')), given = ns(g('택배크기')), P = RK[given] != null ? [given, '원본 값'] : predict(S, o);
        how[P[1]] = (how[P[1]] || 0) + 1; if (P[1] === '처음 보는 분류') unseen[inv] = 1; cnt[P[0]]++; sumQ += +g('매칭총수량') || 0;
        var add = jeju[inv] ? 400 : 0; if (add) nJ++;
        rows.push(TH.map(function(h){ if (h === '택배크기') return P[0]; if (h === '추가운임') return add; if (h === '건수') return 1; if (h === '매칭총수량' || h === '상품종류') return +g(h) || 0;
          var v = g(h); if (v === '' && /택배비|퀵|해외|박스|포장|합포|에어캡/.test(h)) return 0; return v; })); });
      rows.sort(function(a, b){ var i = TH.indexOf('등록일'), j = TH.indexOf('송장번호'); return String(a[i]).localeCompare(String(b[i])) || String(a[j]).localeCompare(String(b[j])); });
      if (tws){ replaceSheet(wb, '배송비', TH, rows); var sw = wb.getWorksheet('배송비'), cN = TH.indexOf('송장번호') + 1, cZ = TH.indexOf('택배크기') + 1;   /* 처음 보는 분류(대량 묶음 등)는 택배크기 노란 칸 — 직접 확인 */
        if (cN && cZ) sw.eachRow(function(row, r){ if (r > 1 && unseen[String(txt(row.getCell(cN).value)).trim()]) row.getCell(cZ).fill = YEL; }); }
      log.push(['자동 적용', '배송비 ' + rows.length + '송장 ← 이벗 택배비 리스트(판매처 스타인터내셔널) · 택배크기 극소 ' + cnt.극소 + ' · 소 ' + cnt.소 + ' · 중 ' + cnt.중 + ' · 대 ' + cnt.대
        + ' (' + Object.keys(how).map(function(k){ return k + ' ' + how[k]; }).join(' · ') + ') · 기준 5~8월 + 표본 ' + learned + '건 · 제주 추가운임 400 ' + nJ + '건']);
      if (!ship.length) log.push(['확인 필요', '이벗 택배비 리스트에 스타인터내셔널(KP) 줄이 없음 — 「00_스타인터내셔널_배송비」 파일을 파일함에 올리고 이 업체 정산에 쓰는 파일 체크']);
      if (how['처음 보는 분류']) log.push(['특이사항', '처음 보는 분류(신발·의류 등 분류가 없는 상품) ' + how['처음 보는 분류'] + '송장은 수량으로 크기(1 극소 · 2~3 소 · 4~6 중 · 7+ 대) — 배송비 시트에서 확인']);

      /* 2) 반품비 */
      var rws = wb.getWorksheet('반품비'), RT = window.RETTRACE || {}, rrows = [], out = [], cntR = { 극소: 0, 소: 0, 중: 0, 대: 0 };
      if (rws){
        var RH = heads(rws);
        ret.forEach(function(x){ var g = function(k){ var i = x.H.indexOf(k); return i >= 0 ? x.r[i] : ''; }, no = String(g('등기번호')).replace(/\D/g, ''), t = RT[no] || null;
          var mine = SELLER.test(String(g('고객명'))), owner = t && t.cust ? SELLER.test(t.cust + ' ' + (t.seller || '')) : null;
          if (owner === false && mine){ out.push(no + '→' + t.cust); return; }
          if (!(owner === true || (owner == null && mine))) return;
          var z = ns(g('박스크기')); if (cntR[z] != null) cntR[z] += +g('수량') || 1;
          rrows.push(RH.map(function(h){ if (h === '원송장' || h === '원송장번호') return t && t.orig ? t.orig : (t ? '확인불가' : ''); if (h === '원송장고객사') return t && t.cust ? t.cust : ''; return g(h); })); });
        replaceSheet(wb, '반품비', RH, rrows);
        if (!nBnc) log.push(['안내', '반품비 — 박스앤캔 택배비가 아직 없어 비워 둠 (오면 파일함에 올리고 🔁 반품비 역추적 후 다시 초안)']);
        else log.push(['자동 적용', '반품비 ' + rrows.length + '건 ← 박스앤캔 「반품」 중 스타인터내셔널' + (Object.keys(RT).length ? ' (🔁 역추적 원송장 주인 기준)' : ' (역추적 기록 없음 — 고객명 기준)') + ' · 극소 ' + cntR.극소 + ' 소 ' + cntR.소 + ' 중 ' + cntR.중 + ' 대 ' + cntR.대]);
        if (out.length) log.push(['특이사항', '반품 고객명은 스타인데 원송장 주인이 다른 업체라 뺀 ' + out.length + '건: ' + out.slice(0, 6).join(', ')]);
      }
      /* 3) 기타 — 비워 둠 */
      var ews = wb.getWorksheet('기타'); if (ews){ var n0 = 0; ews.eachRow(function(row, r){ if (r > 1){ row.eachCell(function(c){ if (c.value != null && c.value !== ''){ c.value = null; n0++; } }); } }); }
      log.push(['안내', '기타 시트 — 다른 택배 반품·별도 청구가 있을 때만 직접 기입 (비워 둠)']);
      /* 4) 입고작업 */
      var iws = wb.worksheets.filter(function(w){ return /입고작업$/.test(w.name); })[0], IH = null;
      if (iws){
        IH = heads(iws); var irows = inRows.map(function(x){ return IH.map(function(h){ var i = x.H.indexOf(h); var v = i >= 0 ? x.r[i] : ''; return /가용입고|불량입고/.test(h) ? (+v || 0) : v; }); });
        replaceSheet(wb, iws.name, IH, irows); iws = wb.getWorksheet(iws.name) || wb.worksheets.filter(function(w){ return /입고작업$/.test(w.name); })[0];
        var nm = MMDD + '_세일즈_입고작업'; if (iws.name !== nm){ log.push(['바꿈', '시트 「' + iws.name + '」 → 「' + nm + '」']); iws.name = nm; }
        if (!inFiles.length) log.push(['확인 필요', '이벗 입고 목록(입고일·구분·가용입고·불량입고)이 파일함에 없어 입고작업 시트가 비었음 — 「00_스타인터내셔널_입고내역」이 주문목록과 같은 내용이면 이벗에서 입고 내역으로 다시 받기']);
        else log.push(['자동 적용', '입고작업 ' + irows.length + '줄 ← ' + inFiles.join(', ')]);
      }

      /* 5) 거래명세표 — 피벗 대신 수식 표 */
      var sws = wb.getWorksheet('배송비'), n1 = rows.length + 1, rv = wb.getWorksheet('반품비'), n2 = rrows.length + 1, iw = iws, n3 = (iw ? Math.max(iw.rowCount, 2) : 2);
      var rng = function(ws, h, n){ var L = ws && colL(ws, h); return L ? "'" + ws.name + "'!$" + L + '$2:$' + L + '$' + Math.max(2, n) : null; };
      var zR = rng(sws, '택배크기', n1), aR = rng(sws, '추가운임', n1), qR = rng(sws, '매칭총수량', n1);
      var bR = rng(rv, '박스크기', n2), bQ = rng(rv, '수량', n2);
      var gR = rng(iw, '구분', n3), gA = rng(iw, '가용입고', n3), gB = rng(iw, '불량입고', n3);
      /* 옆 영역(U~AB, 7~45행) 지난달 피벗 값 지우기 */
      Object.keys(st._merges || {}).forEach(function(k){ var m = st._merges[k].model || st._merges[k]; if (m.left >= 21 && m.top >= 7 && m.top <= 45){ try { st.unMergeCells(m.top, m.left, m.bottom, m.right); } catch (e) {} } });
      for (var r = 7; r <= 45; r++) for (var c = 21; c <= 28; c++){ var cc = st.getRow(r).getCell(c); cc.value = null; cc.style = {}; }
      var put = function(addr, v, o){ var c = st.getCell(addr); c.value = v; c.border = BOX4; c.font = { name: '맑은 고딕', size: 9, bold: !!(o && o.b), color: o && o.w ? { argb: 'FFFFFFFF' } : undefined };
        if (o && o.f) c.fill = o.f; c.alignment = { horizontal: o && o.l ? 'left' : 'center', vertical: 'middle' }; if (typeof v === 'number' || (v && v.formula)) c.numFmt = '#,##0'; return c; };
      var F = function(f, v){ return f ? { formula: f, result: v } : v; };
      /* ① 발송레이블 */
      put('U7', '발송레이블 (배송비 시트)', { b: 1, w: 1, f: TITLEF, l: 1 }); st.mergeCells('U7:W7');
      put('U8', '택배크기', { b: 1, f: HEADF }); put('V8', '건수', { b: 1, f: HEADF }); put('W8', '항공 400', { b: 1, f: HEADF });
      var aCnt = {}; rows.forEach(function(v){ var z = v[TH.indexOf('택배크기')]; if (+v[TH.indexOf('추가운임')] === 400) aCnt[z] = (aCnt[z] || 0) + 1; });
      SZ.forEach(function(z, i){ var rr = 9 + i; put('U' + rr, z); put('V' + rr, F(zR && 'COUNTIFS(' + zR + ',"' + z + '")', cnt[z])); put('W' + rr, F(zR && aR && 'COUNTIFS(' + zR + ',"' + z + '",' + aR + ',400)', aCnt[z] || 0)); });
      put('U13', '합계', { b: 1, f: HEADF }); put('V13', F('SUM(V9:V12)', rows.length), { b: 1, f: HEADF }); put('W13', F('SUM(W9:W12)', nJ), { b: 1, f: HEADF });
      /* ② 반품레이블 */
      put('Z7', '반품레이블 (반품비 시트)', { b: 1, w: 1, f: TITLEF, l: 1 }); st.mergeCells('Z7:AA7');
      put('Z8', '박스크기', { b: 1, f: HEADF }); put('AA8', '수량', { b: 1, f: HEADF });
      SZ.forEach(function(z, i){ var rr = 9 + i; put('Z' + rr, z); put('AA' + rr, F(bR && bQ && 'SUMIFS(' + bQ + ',' + bR + ',"' + z + '")', cntR[z])); });
      var totR = SZ.reduce(function(s, z){ return s + cntR[z]; }, 0);
      put('Z13', '합계', { b: 1, f: HEADF }); put('AA13', F('SUM(AA9:AA12)', totR), { b: 1, f: HEADF });
      /* ③ 피킹 총수량 */
      put('U20', '피킹 총수량 (배송비 매칭총수량 합)', { b: 1, w: 1, f: TITLEF, l: 1 }); st.mergeCells('U20:W20');
      put('U21', '매칭총수량', { b: 1, f: HEADF }); put('V21', F(qR && 'SUM(' + qR + ')', sumQ), { b: 1 });
      /* ④ 입고작업 */
      var inSum = { 반품입고: [0, 0], 정상입고: [0, 0] };
      inRows.forEach(function(x){ var g = function(k){ var i = x.H.indexOf(k); return i >= 0 ? x.r[i] : ''; }, k = String(g('구분')).trim(); if (!inSum[k]) inSum[k] = [0, 0]; inSum[k][0] += +g('가용입고') || 0; inSum[k][1] += +g('불량입고') || 0; });
      put('U31', '입고작업 (' + (iw ? iw.name : '입고작업') + ' 시트)', { b: 1, w: 1, f: TITLEF, l: 1 }); st.mergeCells('U31:X31');
      put('U32', '구분', { b: 1, f: HEADF }); put('V32', '가용입고', { b: 1, f: HEADF }); put('W32', '불량입고', { b: 1, f: HEADF }); put('X32', '합계', { b: 1, f: HEADF });
      ['반품입고', '정상입고'].forEach(function(k, i){ var rr = 33 + i; put('U' + rr, k);
        put('V' + rr, F(gR && gA && 'SUMIFS(' + gA + ',' + gR + ',"' + k + '")', inSum[k][0])); put('W' + rr, F(gR && gB && 'SUMIFS(' + gB + ',' + gR + ',"' + k + '")', inSum[k][1]));
        put('X' + rr, F('V' + rr + '+W' + rr, inSum[k][0] + inSum[k][1])); });
      var inTot = inSum.반품입고[0] + inSum.반품입고[1] + inSum.정상입고[0] + inSum.정상입고[1];
      put('U35', '합계', { b: 1, f: HEADF }); put('V35', F('SUM(V33:V34)', inSum.반품입고[0] + inSum.정상입고[0]), { b: 1, f: HEADF }); put('W35', F('SUM(W33:W34)', inSum.반품입고[1] + inSum.정상입고[1]), { b: 1, f: HEADF }); put('X35', F('SUM(X33:X34)', inTot), { b: 1, f: HEADF });
      [21, 22, 23, 24, 25, 26, 27].forEach(function(c){ if (!st.getColumn(c).width || st.getColumn(c).width < 9) st.getColumn(c).width = 10; }); st.getColumn(21).width = Math.max(st.getColumn(21).width || 0, 12);

      /* 명세표 수량 칸 → 위 표 */
      var line = function(re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(ns(row.getCell(2).value))) hit = r; }); return hit; };
      var setG = function(re, f, v, yel){ var r = line(re); if (!r) return 0; var g = st.getCell('G' + r); g.value = f ? { formula: f, result: v } : v; g.style = Object.assign({}, g.style, { fill: yel ? YEL : { type: 'pattern', pattern: 'none' } }); return r; };
      SZ.forEach(function(z, i){ setG(new RegExp('^택배발송\\(' + z + '\\)'), 'V' + (9 + i), cnt[z]); setG(new RegExp('^반품비\\(' + z + '\\)'), 'AA' + (9 + i), cntR[z]); });
      setG(/^항공비/, 'W13', nJ); setG(/^도선비/, null, 0);
      setG(/^피킹비/, 'V21', sumQ);
      setG(/^입고검수$/, 'X35', inTot); setG(/^반품입고검수/, 'X33', inSum.반품입고[0] + inSum.반품입고[1]);
      var pr = line(/^파렛트입고비/); if (pr){ var pv = +txt(st.getCell('G' + pr).value) || 0; if (pv){ st.getCell('G' + pr).value = 0; st.getCell('G' + pr).fill = YEL; st.getCell('S' + pr).value = null; log.push(['확인 필요', '파렛트입고비 — 지난달 ' + pv + '파렛트(지난달에만 있던 입고) → 0, 이번 달 파렛트 입고가 있으면 수량 입력']); } }
      /* 포장발송대행 = 발송+반품 건수 · 부자재 = 발송 건수 — 지난달 SUM 수식 그대로, 결과값만 이번 달로 */
      [[/^포장발송대행/, rows.length + totR], [/^부자재/, rows.length]].forEach(function(p){ var r = line(p[0]); if (!r) return; var g = st.getCell('G' + r), f = g.value && g.value.formula; g.value = f ? { formula: f, result: p[1] } : p[1]; });
      /* 합계 (명세표 수식은 엑셀이 다시 계산 — 로그용) */
      var supply = 0; st.eachRow(function(row, r){ if (r < 8) return; var b = ns(row.getCell(2).value); if (!b || /소계|합계/.test(b)) return; var g = row.getCell(7).value, h = row.getCell(8).value;
        var gv = g && typeof g === 'object' ? +g.result || 0 : +g || 0, hv = h && typeof h === 'object' ? +h.result || 0 : +h || 0; supply += gv * hv; });
      log.push(['자동 적용', '거래명세표: 오른쪽 피벗 → 수식 표(발송레이블·반품레이블·피킹 총수량·입고작업, COUNTIFS/SUMIFS 로 시트를 바로 셈) · 명세표 수량 칸은 그 표를 가리킴 — 시트를 고치면 명세표가 따라 바뀜']);
      /* 소계·합계·총계 칸에 이번 달 값을 넣어 둠 — 엑셀로 안 열고 그대로 완료 확정에 올려도 합계가 맞게 읽힘 (2026-10-05: 지난달 값·0 으로 읽히던 것) */
      var setRes = function(addr, v){ var c = st.getCell(addr), f = c.value && c.value.formula; if (f) c.value = { formula: f, result: v }; };
      var rSub = 0, rTot = 0; st.eachRow(function(row, r){ if (!rSub && ns(row.getCell(8).value) === '소계') rSub = r; if (!rTot && ns(row.getCell(7).value) === '합계') rTot = r; });
      if (rSub){ setRes('K' + rSub, supply); setRes('O' + rSub, supply * 0.1); }
      if (rTot) setRes('H' + rTot, supply * 1.1);
      ['M6', 'N6', 'O6', 'P6'].forEach(function(a){ setRes(a, supply * 1.1); });
      log.push(['자동 적용', '거래명세표 공급가 ' + won(supply) + ' · 포함가 ' + won(Math.round(supply * 1.1))]);
    });
  }

  E['스타인터내셔널(온라인세일즈)'] = {
    needs: ['ebut_shiplist', 'ebut_orders', 'bnc_courier', 'ebut_instock'], traceSkip: true,
    allAuto: true, items: {}, sheets: {}, verified: {},
    ownSheets: /^(배송비|반품비|기타|\d{4}_세일즈_입고작업)$/,
    opt: { checkSheet: false },
    ruleList: [
      R('배송비 = 이벗 택배비 리스트의 판매처 스타인터내셔널(KP) 송장마다 한 줄 · 추가운임 = 주문목록 주소가 제주인 송장 400 (항공비)'),
      R('택배크기 = 지난 데이터와 같게: ① 같은 상품·사이즈·수량 구성 ② 같은 상품·수량 ③ 분류(신발·의류·모자…)별 수량에서 가장 많던 크기(같으면 큰 쪽) ④ 처음 보는 분류만 수량(1 극소 · 2~3 소 · 4~6 중 · 7+ 대) — 의류는 수량이 많아도 크기가 안 오르던 것 그대로 · 백테스트 8월 95.4%'),
      R('택배크기 기준 = 2026-05 ~ 08 확정본(settle_starol_size.js) + 매달 표본(지난달 확정본) 배송비에서 새로 배움'),
      R('반품비 = 박스앤캔 「반품」 중 스타인터내셔널 — 🔁 반품비 역추적 원송장 주인이 스타인 것 (고객명이 스타여도 원송장 주인이 다른 업체면 빼고 특이사항) · 박스앤캔이 아직 없으면 비워 둠'),
      R('기타 = 다른 택배 반품·별도 청구 같은 특이사항이 있을 때만 직접 기입'),
      R('입고작업 = 이벗 입고 목록(고객사 스타인터내셔널) → MMDD_세일즈_입고작업 · 입고검수 = 가용+불량 전체 · 반품입고검수/피킹원복 = 반품입고 가용+불량'),
      R('거래명세표 오른쪽 피벗(발송레이블·반품레이블·피킹 총수량·입고) → COUNTIFS/SUMIFS 수식 표, 명세표 수량 칸이 그 표를 가리킴 (연산이 살아 있음) · 솔루션·임대료 = 지난달 그대로')
    ],
    afterBuild: after
  };
})();
