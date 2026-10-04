/* ============================================================
   정산관리 — 제이에스로지원(테일즈코리아) (2026-10-04 대표님 · 2025-12 ~ 2026-08 확정본 9개월 분석)
     원본 = 이벗 전체주문목록의 고객사 「테일즈코리아」 줄 전부 (세트는 세트 줄 + 구성품 줄로 펼쳐져 나옴)
     · 토탈집계데이터 = 그 줄 전부 + 택배사이즈·작업형태·출고유형·건수
     · 택배발송건     = 우체국택배 송장마다 첫 줄 (제작후직배송 = 크로스닥은 택배비 없음)
     · 추가작업비     = 작업형태가 일반이 아닌 줄 · 이베이퀵출고작업비 = 쉽먼트 송장마다 첫 줄
     · 택배 사이즈(대표님 룰): ① 예전에 똑같은 구성(상품×수량)을 보낸 적 있으면 가장 최근에 매긴 사이즈
                              ② 처음 보는 구성: 총수량 10개 이하 극소(_F 샘플·샘플팩은 5개 = 1개), 넘으면 상품별 완박스 수량 대비
                                 채움 1 이상 대 · 0.5 이상 중 · 그 밖 소 / 1V 바스켓 8개 이상 대 · 2개 이상 소 이상
                              기준 = settle_tales_size.js(9개월) + 표본(지난달 확정본)에서 새로 배운 것(더 최근이라 우선)
     · 보관비·밀크런·작업 인건추가비 ← 입출고 화물관리 (출고 = 크로스닥·밀크런·쉽먼트 팔레트, 입고 까대기 = 수작업 파렛트, 기타 「○○ N개 제작」)
============================================================ */
(function(){
  'use strict';
  var E = window.SETTLE_ENGINES = window.SETTLE_ENGINES || {};
  var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } }, NOFILL = { type: 'pattern', pattern: 'none' };
  var R = function(t){ return { d: '2026-10-04', t: t }; };
  var SZ = ['극소', '소', '중', '대'], RK = { 극소: 0, 소: 1, 중: 2, 대: 3 };
  function txt(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); if (v instanceof Date) return v.toISOString().slice(0, 10); return v == null ? '' : String(v); }
  function ns(v){ return txt(v).replace(/\s+/g, ''); }

  /* ── 사이즈 룰 ── (스크래치 백테스트와 같은 계산: 이전 달만으로 다음 달 88.7% · 최근 3달 91.3%) */
  function code(n){ var m = String(n || '').match(/^\s*\[(\w+)\]/); return m ? m[1] : ''; }
  function optOf(n){ var m = String(n || '').match(/\(([^()]*)\)\s*$/); return m ? m[1] : ''; }
  /* 송장 한 개의 줄들 → 단위(세트는 세트 줄 하나, 아니면 줄마다) */
  function unitsOf(rows){   /* rows = [{ord, mn, q}] (ord = 이벗 「코드」 = 주문 줄 번호) */
    var g = {}, order = [];
    rows.forEach(function(r){ if (!g[r.ord]){ g[r.ord] = []; order.push(r.ord); } g[r.ord].push(r); });
    var u = [];
    order.forEach(function(k){ var a = g[k], h = null; a.forEach(function(r){ if (!h && /^A\d/.test(code(r.mn))) h = r; });
      if (h && a.length > 1) u.push({ k: optOf(h.mn) || code(h.mn), q: +h.q || 0 });
      else a.forEach(function(r){ u.push({ k: optOf(r.mn) || code(r.mn) || '?', q: +r.q || 0 }); }); });
    return u;
  }
  function sigOf(u){ return u.map(function(x){ return x.k + 'x' + x.q; }).sort().join(','); }
  function boxOf(cap, k){ var c = cap[k]; if (c && c.L) return c.L; if (c && c.M) return c.M * 1.3; if (/_F$/.test(k)) return 200; if (/^[A-Z]{2}$|^[0-9][A-Z]$/.test(k)) return 30; return 40; }
  function ruleSize(cap, u){
    var tot = 0, fill = 0, v = 0;
    u.forEach(function(x){ tot += x.q * (/_F$|^S\d+$|SP$/.test(x.k) ? 0.2 : 1); fill += x.q / boxOf(cap, x.k); if (x.k === '1V') v += x.q; });
    var s = tot <= 10 ? 0 : (fill >= 1 ? 3 : fill >= 0.5 ? 2 : 1);
    if (v >= 8) s = 3; else if (v >= 2) s = Math.max(s, 1);
    return SZ[s];
  }

  /* 표본(지난달 확정본)에서 송장 구성 → 사이즈 배우기 (기준 데이터보다 최근이라 덮어씀) */
  function learnTpl(wb, ex, cap){
    var T = wb.getWorksheet('토탈집계데이터'), K = wb.getWorksheet('택배발송건'); if (!T) return 0;
    var hm = function(ws){ var m = {}; ws.getRow(1).eachCell(function(c, n){ var h = ns(c.value); if (h && m[h] == null) m[h] = n; }); return m; };
    var th = hm(T), kz = {};
    if (K){ var kh = hm(K); K.eachRow(function(row, r){ if (r > 1){ var iv = ns(row.getCell(kh['송장번호']).value), z = ns(row.getCell(kh['택배사이즈']).value); if (iv && RK[z] != null) kz[iv] = z; } }); }
    var by = {};
    T.eachRow(function(row, r){ if (r === 1) return; var iv = ns(row.getCell(th['송장번호']).value); if (!iv || ns(row.getCell(th['택배사']).value) === '제작후직배송') return;
      var z = kz[iv] || ns(row.getCell(th['택배사이즈']).value); if (RK[z] == null) return;
      (by[iv] = by[iv] || { z: z, rows: [] }).rows.push({ ord: ns(row.getCell(th['코드']).value), mn: txt(row.getCell(th['매칭상품명']).value).trim(), q: +txt(row.getCell(th['매칭수량']).value) || 0 }); });
    var n = 0, cnt = {};
    Object.keys(by).forEach(function(iv){ var u = unitsOf(by[iv].rows), s = sigOf(u), z = by[iv].z; (cnt[s] = cnt[s] || {})[z] = (cnt[s][z] || 0) + 1;
      if (u.length === 1){ var k = u[0].k, c = cap[k] = Object.assign({}, cap[k] || {}); if (RK[z] >= 3 && (!c.L || u[0].q < c.L)) c.L = u[0].q; if (RK[z] >= 2 && (!c.M || u[0].q < c.M)) c.M = u[0].q; } });
    Object.keys(cnt).forEach(function(s){ var c = cnt[s]; ex[s] = Object.keys(c).sort(function(a, b){ return c[b] - c[a] || RK[b] - RK[a]; })[0]; n++; });
    return n;
  }

  /* 작업형태 · 출고유형 */
  function outType(seller){ var s = String(seller || ''); if (/크로스닥/.test(s)) return '크로스닥'; if (/이베이|쉽먼트/.test(s)) return '이베이쉽먼트'; return '일반배송'; }
  function workType(r){
    var s = String(r.seller || '');
    if (/크로스닥|쉽먼트/.test(s) && /\*\s*\d+\s*개/.test(r.pn + ' ' + r.opt)) return '묶음작업';          /* 「1인치 소고기 * 2개」 — 2개 묶음 */
    if (!r.head) return '일반';
    var o = optOf(r.mn) || r.opt;
    if (/\(완\)|완\)\s*$/.test(r.mn)) return '일반';                                                       /* SET○(완)·TSTP1(완) = 완성품, 청구 없음 */
    if (/^SET\d+$/i.test(o)) return '선물세트';                                                            /* (완) 없는 세트 = 선물세트 제작 */
    return '파우치작업';                                                                                    /* 혼합2·혼합3·단일2·샘플팩·파우치백 = 파우치 세트 줄 */
  }

  function after(wb, ctx){
    var st = ctx.st, log = ctx.log, box = ctx.BOX || {}, YM = ctx.YM, won = ctx.won;
    var base = window.TALES_SIZE || { ex: {}, cap: {} }, ex = Object.assign({}, base.ex), cap = JSON.parse(JSON.stringify(base.cap || {}));
    var nTpl = learnTpl(wb, ex, cap);
    var ids = Object.keys(box).filter(function(id){ return box[id].type === 'ebut_orders'; });
    var read = function(L){ return L.reduce(function(p, id){ return p.then(function(acc){ ctx.msg && ctx.msg(box[id].name + ' 읽는 중…'); return ctx.readBox(box[id]).then(function(x){ acc.push(x); return acc; }); }); }, Promise.resolve([])); };
    return read(ids).then(function(F){
      /* 1) 이벗 테일즈 줄 */
      var tpl = wb.getWorksheet('토탈집계데이터'); if (!tpl){ log.push(['확인 필요', '표본에 「토탈집계데이터」 시트가 없음']); return; }
      var TH = []; tpl.getRow(1).eachCell({ includeEmpty: true }, function(c, n){ TH[n - 1] = ns(c.value); });
      var rows = [], seen = {}, noMatch = 0;
      F.forEach(function(x){ var a = XLSX.utils.sheet_to_json(x.Sheets[x.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
        var H = a[0].map(ns), ix = function(k){ return H.indexOf(k); }, iC = ix('고객사'); if (iC < 0) return;
        a.slice(1).forEach(function(r){ if (!/테일즈/.test(String(r[iC]))) return;
          var key = [r[ix('코드')], r[ix('매칭상품명')], r[ix('매칭수량')], r[ix('송장번호')]].join('\u0001'); if (seen[key]) return; seen[key] = 1;
          var o = { H: H, r: r, ord: ns(r[ix('코드')]), inv: ns(r[ix('송장번호')]), seller: String(r[ix('판매처')] || ''), courier: ns(r[ix('택배사')]), addr: String(r[ix('주소')] || ''),
            pn: String(r[ix('상품명')] || ''), opt: String(r[ix('옵션')] || ''), mn: String(r[ix('매칭상품명')] || '').trim(), q: +r[ix('매칭수량')] || 0 };
          if (!o.mn) noMatch++; rows.push(o); }); });
      if (!rows.length){ log.push(['확인 필요', '이벗 전체주문목록에 테일즈코리아 줄이 없음 — 「이 업체 정산에 쓰는 파일」에 이벗 전체주문목록이 체크됐는지 확인']); return; }
      if (noMatch) log.push(['특이사항', '매칭상품명이 빈 테일즈 줄 ' + noMatch + '개 — 이벗에서 매칭 펼침으로 다시 내려받았는지 확인 (8월 원본처럼 비어 있으면 사이즈·작업형태를 못 정함)']);
      /* 세트 줄 표시: 같은 주문 줄(코드)에 A코드 줄 + 구성품 */
      var byOrd = {}; rows.forEach(function(o){ (byOrd[o.ord] = byOrd[o.ord] || []).push(o); });
      Object.keys(byOrd).forEach(function(k){ var a = byOrd[k]; if (a.length < 2) return; var h = a.filter(function(o){ return /^A\d/.test(code(o.mn)); })[0]; if (h) h.head = true; });
      /* 2) 송장별 사이즈 */
      var byInv = {}; rows.forEach(function(o){ if (o.courier === '제작후직배송' || !o.inv) return; (byInv[o.inv] = byInv[o.inv] || []).push(o); });
      var size = {}, how = { 같은구성: 0, 룰: 0 }, cnt = { 극소: 0, 소: 0, 중: 0, 대: 0 };
      Object.keys(byInv).forEach(function(iv){ var u = unitsOf(byInv[iv]), s = sigOf(u), z = ex[s];
        if (z) how.같은구성++; else { z = ruleSize(cap, u); how.룰++; } size[iv] = z; cnt[z]++; });
      var jeju = {}; rows.forEach(function(o){ if (o.inv && o.courier !== '제작후직배송' && /^\s*제주/.test(o.addr)) jeju[o.inv] = 1; });
      /* 3) 줄 만들기 (표본 열 순서) */
      var data = rows.map(function(o){ var wt = workType(o), ot = outType(o.seller);
        o.wt = wt; o.ot = ot;
        return TH.map(function(h){
          if (h === '택배사이즈') return o.courier === '제작후직배송' ? '제작후직배송' : (size[o.inv] || '');
          if (h === '작업형태') return wt; if (h === '출고유형') return ot; if (h === '건수') return 1;
          if (h === '추가운임') return jeju[o.inv] ? 3000 : (o.courier === '제작후직배송' ? '' : 0);
          var i = o.H.indexOf(h); return i >= 0 ? o.r[i] : ''; }); });
      var firstOfInv = function(pred){ var s = {}, out = []; data.forEach(function(v, i){ var o = rows[i]; if (!pred(o)) return; if (s[o.inv]) return; s[o.inv] = 1; out.push(v); }); return out; };
      var kb = firstOfInv(function(o){ return o.courier !== '제작후직배송' && o.inv; });
      var add = data.filter(function(v, i){ return rows[i].wt !== '일반'; });
      var eq = firstOfInv(function(o){ return o.ot === '이베이쉽먼트'; });
      var heads = tpl.getRow(1).values.slice(1).map(txt);
      var put = function(name, rs, hd){ if (!wb.getWorksheet(name)) return null; var x = replaceSheet(wb, name, hd || heads, rs); x.warn.forEach(function(w){ log.push(['확인 필요', '시트 「' + name + '」 — ' + w]); }); return x; };
      put('토탈집계데이터', data); put('택배발송건', kb); put('추가작업비', add); put('이베이퀵출고작업비', eq);
      log.push(['자동 적용', '토탈집계데이터 ' + data.length + '줄 · 택배발송건 ' + kb.length + '송장 · 추가작업비 ' + add.length + '줄 · 이베이(쿠팡)쉽먼트 ' + eq.length + '송장']);
      log.push(['자동 적용', '택배 사이즈 극소 ' + cnt.극소 + ' · 소 ' + cnt.소 + ' · 중 ' + cnt.중 + ' · 대 ' + cnt.대 + ' — 예전과 같은 구성 ' + how.같은구성 + '송장(가장 최근 사이즈) · 처음 보는 구성 ' + how.룰 + '송장(수량·완박스 룰) · 기준 = 9개월 + 표본에서 새로 배운 구성 ' + nTpl + '개']);
      var nJ = Object.keys(jeju).length; if (nJ) log.push(['특이사항', '제주 주소 ' + nJ + '송장 = 추가운임 3,000 (거래명세표 제주도 줄)']);

      /* 4) 거래명세표 */
      var col = function(ws, h){ var n = 0; ws.getRow(1).eachCell(function(c, k){ if (!n && ns(c.value) === h) n = k; }); return n ? ws.getColumn(n).letter : null; };
      var rng = function(sheet, h, n){ var ws = wb.getWorksheet(sheet), L = ws && col(ws, h); return L ? "'" + sheet + "'!$" + L + '$2:$' + L + '$' + Math.max(2, n + 1) : null; };
      var line = function(re){ var hit = 0; st.eachRow(function(row, r){ if (!hit && re.test(ns(row.getCell(2).value))) hit = r; }); return hit; };
      var setG = function(r, f, v){ if (!r) return; var g = st.getCell('G' + r); g.value = f ? { formula: f, result: v } : v; g.style = Object.assign({}, g.style, { fill: NOFILL }); };
      var zR = rng('택배발송건', '택배사이즈', kb.length), aR = rng('택배발송건', '추가운임', kb.length);
      [['극소', /^택배발송\(극소\)/], ['소', /^택배발송\(소\)/], ['중', /^택배발송\(중\)/], ['대', /^택배발송\(대\)/]].forEach(function(p){ setG(line(p[1]), zR && 'COUNTIF(' + zR + ',"' + p[0] + '")', cnt[p[0]]); });
      setG(line(/^택배발송\(이형\)/), null, 0);
      setG(line(/^제주도$/), aR && 'COUNTIF(' + aR + ',">0")', nJ);
      var wR = rng('추가작업비', '작업형태', add.length), qR = rng('추가작업비', '매칭수량', add.length);
      var wsum = function(t){ return add.reduce(function(s, v, i){ return s + (v[TH.indexOf('작업형태')] === t ? +v[TH.indexOf('매칭수량')] || 0 : 0); }, 0); };
      setG(line(/^묶음작업비/), wR && 'SUMIF(' + wR + ',"묶음작업",' + qR + ')/2', wsum('묶음작업') / 2);
      setG(line(/^선물세트작업비/), wR && 'SUMIF(' + wR + ',"선물세트",' + qR + ')', wsum('선물세트'));
      var pr = line(/^파우치작업비/); setG(pr, wR && 'SUMIF(' + wR + ',"파우치작업",' + qR + ')', wsum('파우치작업'));
      var eR = rng('이베이퀵출고작업비', '건수', eq.length); setG(line(/^이베이.*출고작업비/), eR && 'SUM(' + eR + ')', eq.length);
      /* 옆 피벗 표(S~W) 지우고 이번 달 요약 */
      for (var r2 = 7; r2 <= 34; r2++) for (var c2 = 19; c2 <= 23; c2++){ var cc = st.getRow(r2).getCell(c2); if (cc.value != null) cc.value = null; }
      var side = [['택배사이즈', '송장'], ['극소', cnt.극소], ['소', cnt.소], ['중', cnt.중], ['대', cnt.대], ['같은 구성', how.같은구성], ['처음 보는 구성', how.룰], [], ['작업형태', '매칭수량'], ['묶음작업', wsum('묶음작업')], ['선물세트', wsum('선물세트')], ['파우치작업', wsum('파우치작업')], ['쉽먼트 송장', eq.length]];
      side.forEach(function(s, i){ if (!s.length) return; st.getRow(8 + i).getCell(20).value = s[0]; st.getRow(8 + i).getCell(21).value = s[1]; });
      log.push(['자동 적용', '거래명세표: 택배 극소·소·중·대 = 택배발송건 사이즈 COUNTIF · 제주도 = 추가운임 COUNTIF · 묶음 = 묶음 매칭수량÷2 · 선물세트·파우치 = 매칭수량 SUMIF · 쉽먼트 = 송장 수']);
      log.push(['자동 적용', '파우치작업비 = 파우치 세트(혼합2·혼합3·단일2·샘플팩 등, (완) 제외) 개수 ' + won(wsum('파우치작업')) + ' — 단품 TS·TP·구성품은 안 셈']);

      /* 5) 화물관리: 보관비·밀크런·작업 인건추가비 */
      var Y = +YM.slice(0, 4), Mo = +YM.slice(5, 7), ND = new Date(Date.UTC(Y, Mo, 0)).getUTCDate(), S0 = Math.round(Date.UTC(Y, Mo - 1, 1) / 864e5) + 25569;
      var VM = window.vendorMatcher('제이에스로지원(테일즈코리아)', ['테일즈']);
      var C = (ctx.CARGO || []).filter(function(x){ return x && String(x.date || '').slice(0, 7) === YM && VM(x.vendor); }).sort(function(a, b){ return String(a.date).localeCompare(String(b.date)); });
      if (!ctx.CARGO) log.push(['확인 필요', '입출고 화물관리 기록을 못 읽어 보관비·밀크런·제작 줄을 못 채움']);
      var memo = function(x){ return String(x.memo || x.note || ''); }, pl = function(x){ return (+x.aj || 0) + (+x.etc || 0); }, dnum = function(x){ return Math.round(Date.parse(x.date + 'T00:00:00Z') / 864e5) + 25569; };
      var bs = wb.getWorksheet('보관비'), mk = [];
      if (bs){
        var bh = {}; bs.getRow(1).eachCell(function(c, n){ bh[ns(c.value)] = n; });
        var cA = bh['보관일'], cB = bh['입고파렛'], cC = bh['일반출고파렛'], cD = bh['밀크런출고'], cE = bh['보관파렛'], cF = bh['입고내용'], cG = bh['출고내용'], cH = bh['수작업입출고파렛트'];
        var sumR = 0; bs.eachRow(function(row, r){ if (!sumR && r > 1 && row.getCell(cB).value && row.getCell(cB).value.formula) sumR = r; });
        var keepE = 0; for (var r3 = 2; r3 < (sumR || 33); r3++){ var e3 = +txt(bs.getRow(r3).getCell(cE).value); if (e3) keepE = e3; }
        if (sumR && cA && cE){
          for (var r4 = 2; r4 < sumR; r4++){ var rw = bs.getRow(r4); [cA, cB, cC, cD, cE, cF, cG, cH].forEach(function(c){ if (c) rw.getCell(c).value = null; }); }
          var day = {}; C.forEach(function(x){ var d = dnum(x), o = day[d] = day[d] || { b: 0, c: 0, d: 0, h: 0, fi: [], fo: [] };
            if (x.kind === 'in'){ o.b += pl(x); if (/까대기|컨테이너|수작업/.test(memo(x))) o.h += pl(x); o.fi.push(memo(x)); }
            else if (x.kind === 'out'){ if (/크로스닥|밀크런|쉽먼트|쿠팡/.test(memo(x))){ o.d += pl(x); mk.push(x); } else o.c += pl(x); o.fo.push(memo(x)); } });
          for (var i = 0; i < ND && 2 + i < sumR; i++){ var rr = bs.getRow(2 + i), dd = S0 + i, o2 = day[dd];
            rr.getCell(cA).value = dd; rr.getCell(cE).value = keepE;
            if (o2){ if (o2.b) rr.getCell(cB).value = o2.b; if (o2.c) rr.getCell(cC).value = o2.c; if (o2.d) rr.getCell(cD).value = o2.d; if (cH && o2.h) rr.getCell(cH).value = o2.h;
              if (cF && o2.fi.length) rr.getCell(cF).value = o2.fi.join(' / '); if (cG && o2.fo.length) rr.getCell(cG).value = o2.fo.join(' / '); } }
          var colL = function(c){ return bs.getColumn(c).letter; };
          [cB, cC, cD, cH].forEach(function(c){ if (c){ var tot = 0; for (var k = 2; k < sumR; k++) tot += +txt(bs.getRow(k).getCell(c).value) || 0; bs.getRow(sumR).getCell(c).value = { formula: 'SUM(' + colL(c) + '2:' + colL(c) + (sumR - 1) + ')', result: tot }; } });
          bs.getRow(sumR).getCell(cE).value = keepE;
          log.push(['자동 적용', '보관비 시트: 보관파렛 ' + keepE + ' (지난달 그대로) · 화물관리 ' + C.length + '건 → 입고·밀크런(크로스닥·쉽먼트)·일반출고·수작업(까대기) 파렛트']);
          log.push(['특이사항', '보관파렛 ' + keepE + ' 은 지난달 값 그대로 — 이번 달 바뀌었으면 보관비 시트 맨 아래 보관파렛 칸 수정']);
          bs.getRow(sumR).getCell(cE).fill = YEL;
        } else log.push(['확인 필요', '보관비 시트 형식이 달라 지난달 그대로']);
      }
      if (wb.getWorksheet('밀크런출고비')){
        var MH = []; wb.getWorksheet('밀크런출고비').getRow(1).eachCell(function(c, n){ MH[n - 1] = txt(c.value); });
        var mrows = mk.map(function(x){ return MH.map(function(h){ var k = ns(h);
          if (k === '입고일') return dnum(x); if (k === '팔레트수') return pl(x); if (k === '트럭수') return /밀크런/.test(memo(x)) ? '밀크런' : '1 트럭'; if (k === '센터') return /크로스닥/.test(memo(x)) ? '인천13' : ''; return ''; }); });
        put('밀크런출고비', mrows, MH);
        var ws2 = wb.getWorksheet('밀크런출고비'), cd2 = col(ws2, '입고일'); if (cd2) for (var q = 2; q <= mrows.length + 1; q++) ws2.getCell(cd2 + q).numFmt = 'yyyy-mm-dd';
        log.push(['자동 적용', '밀크런출고비 ← 화물관리 출고(크로스닥·밀크런·쉽먼트) ' + mrows.length + '건 · 팔레트 ' + mk.reduce(function(s, x){ return s + pl(x); }, 0) + ' (쉽먼트 번호·예약번호·납품 수량은 비어 있음)']);
      }
      /* 작업 인건추가비 = 화물관리 「기타」의 「○○ N개 제작」 (파우치 300 · 선물세트+박스 900 · 선물세트 750) */
      var r0 = line(/작업인건추가비/), rEnd = line(/^택배반품비/);
      if (r0 && rEnd){
        var jobs = [];
        C.forEach(function(x){ memo(x).split(/\r?\n/).forEach(function(t){ t = t.replace(/\s*-\s*매칭.*$/, '').trim(); var m = t.match(/(\d+)\s*개\s*제작/); if (!m) return;
          var price = /파우치/.test(t) ? 300 : /박스/.test(t) ? 900 : /선물세트/.test(t) ? 750 : 0; jobs.push({ d: +x.date.slice(8, 10), t: t, q: +m[1], p: price }); }); });
        var slots = []; for (var r5 = r0 + 1; r5 < rEnd; r5++) slots.push(r5);
        slots.forEach(function(r){ ['A', 'B', 'G', 'H'].forEach(function(c){ st.getCell(c + r).value = null; }); });
        jobs.forEach(function(j, i){ var r = slots[i]; if (!r) return; st.getCell('A' + r).value = j.d; st.getCell('B' + r).value = j.t; st.getCell('G' + r).value = j.q; st.getCell('H' + r).value = j.p || null; if (!j.p) st.getCell('H' + r).fill = YEL; });
        if (jobs.length > slots.length) log.push(['확인 필요', '제작 건 ' + jobs.length + '개인데 거래명세표 칸은 ' + slots.length + '줄 — 넘친 건: ' + jobs.slice(slots.length).map(function(j){ return j.d + '일 ' + j.t; }).join(' / ')]);
        log.push([jobs.length ? '자동 적용' : '안내', '작업 인건추가비 ← 화물관리 제작 기록 ' + jobs.length + '건' + (jobs.length ? ': ' + jobs.map(function(j){ return j.d + '일 ' + j.t + ' ' + j.q + '×' + won(j.p); }).join(' / ') : '') + ' (파우치 300 · 선물세트+박스 900 · 선물세트 750)']);
      }
      /* 반품 = 이번 달 따로 (참조 파일 반품이 있으면 그 시트로) */
      var rRet = line(/^택배반품비/), rYong = line(/^용차비$/);
      if (rRet){ st.getCell('G' + rRet).value = 0;
        for (var r6 = rRet + 1; r6 < (rYong || rRet + 5); r6++){ ['A', 'B', 'G', 'H'].forEach(function(c){ st.getCell(c + r6).value = null; }); }
        log.push(['안내', '택배 반품·착불 줄은 비워 둠 — 이번 달 반품이 있으면 직접 입력']); }
    });
  }

  E['제이에스로지원(테일즈코리아)'] = {
    needs: ['ebut_orders'], traceSkip: true,   /* 화물관리·화물 청구서는 보관비·밀크런·제작·용차비 시트로 이미 들어감 */
    items: { 9: 'auto', 10: 'auto', 11: 'auto', 12: 'auto', 13: 'auto', 14: 'auto', 20: 'auto', 21: 'auto', 23: 'auto', 25: 'auto',
             36: 'auto', 37: 'auto', 38: 'auto', 39: 'auto', 40: 'auto', 41: 'auto', 44: 'auto', 45: 'auto', 46: 'auto', 47: 'auto', 48: 'auto', 49: 'fixed' },
    sheets: {}, verified: {},
    ownSheets: /^(토탈집계데이터|택배발송건|추가작업비|이베이퀵출고작업비|보관비|밀크런출고비|택배반품)$/,
    opt: { checkSheet: false },
    ruleList: [
      R('원본 = 이벗 전체주문목록 고객사 「테일즈코리아」 줄 전부(세트는 세트 줄 + 구성품 줄) → 토탈집계데이터, 출고유형 = 판매처(일반→일반배송 · 크로스닥→크로스닥 · 이베이·쿠팡쉽먼트→이베이쉽먼트)'),
      R('택배발송건 = 우체국택배 송장마다 첫 줄 (제작후직배송 = 크로스닥은 택배비 없음) · 거래명세표 극소 2,100 · 소 2,700 · 중 3,400 · 대 5,000 = 사이즈 COUNTIF · 작업비 950 × 택배 건수'),
      R('택배 사이즈 ① 예전에 똑같은 구성(상품×수량)을 보낸 적 있으면 가장 최근에 매긴 사이즈 (같은 구성도 시간이 지나며 중→대로 커짐 — 최근 기준)'),
      R('택배 사이즈 ② 처음 보는 구성: 총수량 10개 이하 극소 (_F 샘플·샘플팩은 손바닥만 해서 5개 = 1개), 넘으면 상품별 완박스 수량(예전에 가장 크게 매긴 기준) 대비 채움 1 이상 대 · 0.5 이상 중 · 그 밖 소'),
      R('1V 바스켓은 8개 이상 대 · 2개 이상 소 이상 · 사이즈는 노란 칸 없이 바로 넣음 (백테스트: 이전 달만으로 다음 달 88.7%, 최근 3달 91.3%, 금액은 확정본보다 7개월 +38,700)'),
      R('사이즈 기준 = 2025-12 ~ 2026-08 확정본 9개월(settle_tales_size.js) + 매달 표본(지난달 확정본)에서 새로 배운 구성 — 더 최근 것이 우선'),
      R('추가작업비 = 작업형태가 일반이 아닌 줄: 묶음작업(크로스닥·쉽먼트 상품명 「* N개」) 매칭수량÷2 × 300 · 선물세트(SET○, (완) 없음) 매칭수량 × 750 · 파우치(파우치 세트 줄) 매칭수량 × 300 · SET○(완) = 완성품, 청구 없음'),
      R('이베이(쿠팡)쉽먼트 출고작업비 = 쉽먼트 송장 수 × 1,500 · 제주 주소 송장 = 추가운임 3,000'),
      R('보관비 시트 ← 화물관리: 입고 → 입고파렛(까대기·컨테이너면 수작업 파렛트도), 출고 크로스닥·밀크런·쉽먼트 → 밀크런출고, 그 밖 출고 → 일반출고 · 보관파렛 = 지난달 값 그대로(노란 칸)'),
      R('밀크런출고비 ← 화물관리 크로스닥·밀크런·쉽먼트 출고 팔레트 · 작업 인건추가비 ← 화물관리 「○○ N개 제작」 (파우치 300 · 선물세트+박스 900 · 선물세트 750) · 반품 줄은 비우고 직접 입력'),
      R('파우치작업비 = 주문의 파우치 세트(혼합2·혼합3·단일2·샘플팩 등, (완) 제외) 개수 × 300 — 단품 TS·TP 와 세트 안 구성품은 안 셈 (대표님 확인)')
    ],
    afterBuild: after
  };
})();
