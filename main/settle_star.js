/* ============================================================
   정산관리 — 스타인터내셔널 작업 ROW ↔ STAR 재고관리 입출고 대조 (2026-10-05 대표님)
   작업 ROW = 스타 작업지시서 원본 (Dropbox 작업지시서모음/스타인터내셔널/YYYYMM_작업내용):
     입고  (검수완료)YYMMDD_…  — 「약식」 시트 바코드·수량 (검수 끝난 입고 수량)
     출고  MMDD_쿠팡출고_…     — 쿠팡 발주서(PO_SKU_LIST) 확정수량
     출고  MMDD_본사이관_…     — 재고출고양식 (박스바코드·바코드·수량·비고)
   이 수량들은 STAR 재고관리(star_instock/logs) 입출고와 같아야 한다 →
     파일마다 같은 방향의 STAR 기록 묶음(엑셀 업로드 1번 = batchId, 쿠팡 출고 세션 1번 = coupangSessionId)을 바코드 수량이 가장 많이 겹치는 것으로 짝짓고
     ① 짝 = 바코드별 수량 차이  ② ROW 만 있음 = 재고 반영 누락?  ③ STAR 기록만 있음(이 달) = 작업 ROW 빠짐 → 청구 누락? 을 보여 준다.
   브라우저(settlement.html) · Node 공용 — 전역 XLSX 필요.
============================================================ */
(function(root){
  'use strict';
  var X = function(){ return root.XLSX || (typeof require === 'function' ? require('xlsx') : null); };
  var ns = function(v){ return String(v == null ? '' : v).replace(/\s+/g, ''); };

  /* 바코드 열쇠: 공백 제거·대문자, 대체바코드 앞 A 빼기, 앞 0 빼기 (030673169629 = 30673169629) */
  function bkey(v){
    var s = ns(v).toUpperCase(); if (!s) return '';
    if (/^A\d{6,}$/.test(s)) s = s.slice(1);
    if (/^\d+$/.test(s)) s = s.replace(/^0+/, '');
    return s;
  }

  /* 제목줄(need 글자를 모두 가진 줄)을 위 15줄에서 찾아 { head, rows } */
  function table(ws, need){
    var a = X().utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    for (var i = 0; i < Math.min(a.length, 15); i++){
      var h = a[i].map(ns);
      if (need.every(function(k){ return h.indexOf(k) >= 0; })) return { head: h, rows: a.slice(i + 1) };
    }
    return null;
  }

  /* 파일 이름의 날짜 — MMDD_… 또는 (검수완료)YYMMDD_… */
  function nameDate(name, ym){
    var n = String(name || ''), m = n.match(/(?:^|[^\d])(\d{2})(\d{2})(\d{2})_/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return '20' + m[1] + '-' + m[2] + '-' + m[3];
    m = n.match(/^(\d{2})(\d{2})_/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return (ym ? ym.slice(0, 4) : '') + '-' + m[1] + '-' + m[2];
    return '';
  }

  /* 파일 이름에 적어 둔 수량 — 「…_1444개_…」「…_1477족…」, 입고는 「…_2303_(컬러링)」「…_7,137.xlsx」 */
  function nameQty(name){
    var n = String(name || ''), m = n.match(/([\d,]+)\s*(?:개|족)/);
    if (!m) m = n.replace(/^\D*\d{4,6}_/, '').match(/_([\d,]{3,})(?=[_.(\s]|$)/);
    var q = m ? +m[1].replace(/,/g, '') : 0;
    return q > 0 ? q : null;
  }

  /* 작업 ROW 파일 모양 알아보기 (settle_types.js 판별용) — f = profile 결과 */
  function looks(f){
    var has = function(s, arr){ return arr.every(function(x){ return s.headers.has(x); }); };
    var name = String(f.name || '');
    for (var i = 0; i < f.sheets.length; i++){
      var s = f.sheets[i];
      if (has(s, ['박스바코드','바코드','수량'])) return 'move';                                   /* 재고출고양식 (본사이관 등) */
      if ((s.name === '약식' || s.name === '검수파일') && f.sheets.some(function(x){ return x.name === '약식'; })) return 'in';   /* 검수 끝난 입고 */
      if (has(s, ['발주번호','물류센터','확정수량']) && /쿠팡\s*출고|쿠팡출고|택배쉽먼트|스타/.test(name)) return 'po';   /* 스타 쿠팡 출고 발주서 (이름으로 앳댓·포인트 발주서와 구분) */
    }
    return null;
  }

  /* 작업 ROW 읽기 → { dir:'in'|'out', kind, date, items:{열쇠:{bc, name, qty, info}}, total, lines } */
  function parse(wb, name, ym){
    var out = { name: name, date: nameDate(name, ym), nameQty: nameQty(name), items: {}, total: 0, lines: 0, dir: '', kind: '' };
    var add = function(bc, qty, nm, info){
      var k = bkey(bc), q = +qty || 0; if (!k || !q) return;
      var it = out.items[k] || (out.items[k] = { bc: ns(bc), name: nm || '', qty: 0, info: info || '' });
      it.qty += q; out.total += q; out.lines++;
      if (!it.name && nm) it.name = nm;
    };
    var sn = wb.SheetNames, T, c, i;
    /* 1) 쿠팡 발주서 — 확정수량, 원본바코드 열이 있으면 그것 */
    for (i = 0; i < sn.length && !out.dir; i++){
      T = table(wb.Sheets[sn[i]], ['발주번호','물류센터']); if (!T) continue;
      c = function(n){ return T.head.indexOf(n); };
      var iQ = c('확정수량') >= 0 ? c('확정수량') : c('발주수량'), iB = c('원본바코드') >= 0 ? c('원본바코드') : c('SKUBarcode'), iN = c('SKU이름'), iC = c('물류센터');
      if (iQ < 0 || iB < 0) continue;
      out.dir = 'out'; out.kind = '쿠팡출고';
      T.rows.forEach(function(r){ add(r[iB], r[iQ], String(r[iN] || '').trim(), String(r[iC] || '').trim()); });
    }
    /* 2) 재고출고양식 — 박스바코드·바코드·수량·비고 */
    for (i = 0; i < sn.length && !out.dir; i++){
      T = table(wb.Sheets[sn[i]], ['박스바코드','바코드','수량']); if (!T) continue;
      c = function(n){ return T.head.indexOf(n); };
      var nb = c('비고');
      out.dir = 'out'; out.kind = '재고출고';
      T.rows.forEach(function(r){ add(r[c('바코드')], r[c('수량')], '', nb >= 0 ? String(r[nb] || '').trim() : ''); if (!out.note && nb >= 0 && r[nb]) out.note = String(r[nb]).trim(); });
      if (out.note) out.kind = out.note;
    }
    /* 3) 검수 입고 — 「약식」 시트 바코드·수량 */
    if (!out.dir && wb.Sheets['약식']){
      T = table(wb.Sheets['약식'], ['바코드','수량']);
      if (T){
        c = function(n){ return T.head.indexOf(n); };
        var iNm = c('한글품명') >= 0 ? c('한글품명') : c('품명'), iCd = c('품번');
        out.dir = 'in'; out.kind = '입고(검수)';
        T.rows.forEach(function(r){ add(r[c('바코드')], r[c('수량')], [r[iCd], r[iNm]].filter(Boolean).join(' '), ''); });
      }
    }
    return out;
  }

  var KST = function(t){ return new Date((+t || 0) + 9 * 3600e3).toISOString().slice(0, 10); };
  function addDays(d, n){ var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function monthEnd(ym){ return ym + '-' + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0'); }

  /* STAR 기록 → 묶음. 엑셀 업로드 = batchId, 쿠팡 출고 = 세션, 그 밖(스캔·조정) = 날짜·방향별
     logs = { key: {ts,type,source,barcode,altBarcode,qty,defQty,batchId,batchName,coupangSessionId,note} }, orders = star_outorder/orders (세션 → 발주서 파일 이름) */
  function batches(logs, orders, from, to){
    var sess = {};
    Object.keys(orders || {}).forEach(function(k){ var o = orders[k] || {}, c = o.coupang || {}; if (c.sessionId) sess[c.sessionId] = { file: c.poFileName || '', date: o.outboundDate || '', id: o.orderId || k }; });
    var alt = {}, B = {};
    Object.keys(logs || {}).forEach(function(k){ var l = logs[k] || {}; if (l.altBarcode && l.barcode){ var a = bkey(l.altBarcode), b = bkey(l.barcode); if (a && b && a !== b) alt[a] = b; } });
    Object.keys(logs || {}).forEach(function(k){
      var l = logs[k] || {}, d = KST(l.ts), q = +l.qty || 0;
      if (d < from || d > to || !q || l.source === 'closing' || l.source === 'memo') return;
      var dir = l.type === 'out' ? 'out' : 'in', id, nm, src;
      if (l.coupangSessionId){ id = 'C:' + l.coupangSessionId; var s = sess[l.coupangSessionId] || {}; nm = s.file || ('쿠팡 출고 세션 ' + l.coupangSessionId); src = '쿠팡 출고 작업'; }
      else if (l.batchId){ id = 'B:' + l.batchId; nm = l.batchName || l.batchId; src = '엑셀 일괄 ' + (dir === 'in' ? '입고' : '출고'); }
      else { id = 'S:' + dir + ':' + d + ':' + (l.source || ''); nm = ({ scan: '바코드 스캔', adjust: '재고 수정(조정)' }[l.source] || (l.source || '기타')) + ' ' + d.slice(5); src = '수동'; }
      var b = B[id] || (B[id] = { id: id, dir: dir, name: nm, src: src, manual: id.charAt(0) === 'S', d0: d, d1: d, items: {}, total: 0, def: 0, n: 0, note: '' });
      if (!b.note && l.note && !l.coupangSessionId) b.note = String(l.note).trim();
      if (d < b.d0) b.d0 = d; if (d > b.d1) b.d1 = d;
      var kk = bkey(l.barcode); kk = alt[kk] || kk;
      var it = b.items[kk] || (b.items[kk] = { bc: l.barcode, name: l.name || '', qty: 0 });
      it.qty += q; b.total += q; b.def += +l.defQty || 0; b.n++;
    });
    return { list: Object.keys(B).map(function(k){ return B[k]; }), alt: alt };
  }

  /* 대조 — files = [{ id, name, wb }] (작업 ROW), ym = 'YYYY-MM'
     → { pairs:[{f, b, score, diff:[{k,bc,name,fq,bq}]}], rowOnly:[f], starOnly:[b], manual:[b], files, from, to } */
  function compare(files, logs, orders, ym){
    var from = ym + '-01', to = monthEnd(ym);
    /* 짝 찾기는 넓게(앞달 검수 파일이 이번 달에 올라가는 일, 말일 작업이 다음 달 초 마감) — 짝 없는 STAR 기록 보고는 이 달만 */
    var BB = batches(logs, orders, addDays(from, -45), addDays(to, 10)), alt = BB.alt;
    var F = files.map(function(x){
      var p = parse(x.wb, x.name, ym);
      Object.keys(p.items).forEach(function(k){ var a = alt[k]; if (a && !p.items[a]){ p.items[a] = p.items[k]; delete p.items[k]; } });
      p.id = x.id; return p;
    });
    var cands = [];
    F.forEach(function(f, fi){ if (!f.dir) return;
      BB.list.forEach(function(b, bi){ if (b.dir !== f.dir || b.manual) return;
        var ov = 0; Object.keys(f.items).forEach(function(k){ if (b.items[k]) ov += Math.min(f.items[k].qty, b.items[k].qty); });
        var sc = ov / Math.max(f.total, b.total, 1);
        if (b.name && ns(b.name) === ns(f.name)) sc += .2;   /* 쿠팡 출고 세션이 같은 발주서 파일로 시작했으면 가산 */
        if (sc >= .3) cands.push({ fi: fi, bi: bi, sc: sc });
      }); });
    cands.sort(function(a, b){ return b.sc - a.sc; });
    var uf = {}, ub = {}, pairs = [];
    cands.forEach(function(c){ if (uf[c.fi] || ub[c.bi]) return; uf[c.fi] = ub[c.bi] = 1;
      var f = F[c.fi], b = BB.list[c.bi], diff = [], keys = {};
      Object.keys(f.items).concat(Object.keys(b.items)).forEach(function(k){ keys[k] = 1; });
      Object.keys(keys).forEach(function(k){ var fq = f.items[k] ? f.items[k].qty : 0, bq = b.items[k] ? b.items[k].qty : 0;
        if (fq !== bq) diff.push({ k: k, bc: (f.items[k] || b.items[k]).bc, name: (f.items[k] && f.items[k].name) || (b.items[k] && b.items[k].name) || '', fq: fq, bq: bq }); });
      diff.sort(function(x, y){ return Math.abs(y.fq - y.bq) - Math.abs(x.fq - x.bq); });
      pairs.push({ f: f, b: b, score: Math.min(1, c.sc), diff: diff });
    });
    pairs.sort(function(x, y){ return (x.b.d0 || '').localeCompare(y.b.d0 || ''); });
    var inMonth = function(b){ return b.d1 >= from && b.d0 <= to; };
    var starOnly = BB.list.filter(function(b, i){ return !ub[i] && !b.manual && inMonth(b); }).sort(function(x, y){ return x.d0.localeCompare(y.d0); });
    /* 짝 없는 입고·출고가 바코드·수량까지 똑같으면 서로 상쇄 (잘못 올린 걸 되돌렸거나, 들어오자마자 그대로 나간 작업) */
    var same = function(a, b){ if (a.total !== b.total) return false; var ks = Object.keys(a.items); return ks.length === Object.keys(b.items).length && ks.every(function(k){ return b.items[k] && b.items[k].qty === a.items[k].qty; }); };
    starOnly.forEach(function(a){ if (a.dir !== 'in' || a.offset) return;
      starOnly.forEach(function(b){ if (b.dir === 'out' && !b.offset && !a.offset && b.d0 >= a.d0 && same(a, b)){ a.offset = b; b.offset = a; } }); });
    /* 엑셀 없는 STAR 입고인데, 그 물건이 뒤에 엑셀 있는 출고로 나갔으면 = 실제 입고 작업 → 입고 검수 엑셀 빠짐(청구 누락) (대표님 2026-10-05: 9/17 아디다스 입고 → 9/29 출고) */
    starOnly.forEach(function(b){ if (b.dir !== 'in' || b.offset) return;   /* 같은 수량 출고로 상쇄된 입고(재고제로화 등)는 근거로 안 씀 */
      b.usedBy = F.filter(function(f){ return f.dir === 'out' && (!f.date || f.date >= b.d0); }).map(function(f){
        var q = 0; Object.keys(f.items).forEach(function(k){ if (b.items[k]) q += Math.min(f.items[k].qty, b.items[k].qty); });
        return { name: f.name, date: f.date, qty: q };
      }).filter(function(u){ return u.qty > 0; }).sort(function(x, y){ return y.qty - x.qty; });
    });
    return {
      pairs: pairs,
      rowOnly: F.filter(function(f, i){ return !uf[i]; }),
      starOnly: starOnly,
      manual: BB.list.filter(function(b){ return b.manual && inMonth(b); }).sort(function(x, y){ return x.d0.localeCompare(y.d0); }),
      files: F, from: from, to: to
    };
  }

  root.SETTLE_STAR = { looks: looks, parse: parse, compare: compare, bkey: bkey, nameDate: nameDate, nameQty: nameQty };
})(typeof window !== 'undefined' ? window : global);

/* ── 화면 (settlement.html 파일함 「⭐ 스타인터내셔널 작업 ROW」 묶음 → 🔍 STAR 재고관리와 대조) ──
   쓰는 전역: BOX, YM, GID, db, decryptBox(settle_build.js), esc, ymLabel */
function starCheck(){
  var ov = document.getElementById('starOv'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'starOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:1080px;width:100%;margin:0"><div class="card-h"><span class="card-t">⭐ 스타인터내셔널 작업 엑셀(정산 기준) 대비 STAR 재고관리 점검 — ' + esc(ymLabel(YM)) + '</span>'
    + '<button class="btn" style="margin-left:auto" onclick="document.getElementById(\'starOv\').remove()">닫기</button></div><div id="starBody" class="sec-note">파일 여는 중…</div></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
  var body = function(h){ var b = document.getElementById('starBody'); if (b) b.innerHTML = h; };
  var ids = Object.keys(BOX).filter(function(id){ return BOX[id].type === 'star_row'; });
  var base = 'wms_sync/groups/' + (GID || 'makechango') + '/', files = [];
  ids.reduce(function(p, id){ return p.then(function(){ return decryptBox(BOX[id]).then(function(b){ files.push({ id: id, name: BOX[id].name, wb: XLSX.read(b, { type: 'array' }) }); }); }); }, Promise.resolve())
    .then(function(){ body('STAR 재고관리 입출고 기록 읽는 중…');
      return Promise.all([db.ref(base + 'star_instock/logs').get(), db.ref(base + 'star_outorder/orders').get()]); })
    .then(function(r){ body(starHtml(SETTLE_STAR.compare(files, r[0].val() || {}, r[1].val() || {}, YM))); })
    .catch(function(e){ body('<span style="color:#f87171">대조 실패: ' + esc((e && (e.code || e.message)) || e) + '</span>'); console.error(e); });
}
/* 엑셀(작업 ROW) = 정산 기준 (대표님 2026-10-05) — 엑셀 대비로 STAR 를 점검한다.
   STAR 가 엑셀보다 많음 = 엑셀에 없는 작업 → 받을 돈 놓침? / 실작업과 별개인 임의 변동?
   STAR 가 엑셀보다 적음 = 엑셀대로 작업했는데 재고에 덜 반영 */
function starHtml(R){
  var n = function(v){ return (+v || 0).toLocaleString('ko-KR'); };
  var sg = function(v){ return (v > 0 ? '+' : '') + n(v); };
  var dirL = function(d){ return d === 'in' ? '<b style="color:var(--g);white-space:nowrap">입고</b>' : '<b style="color:var(--b);white-space:nowrap">출고</b>'; };
  var bad = function(t){ return '<b style="color:#f87171">' + t + '</b>'; }, warn = function(t){ return '<b style="color:var(--y)">' + t + '</b>'; }, good = '<b style="color:var(--g)">✔ STAR 일치</b>';
  var span = function(b){ return b.d0 === b.d1 ? b.d0 : b.d0 + ' ~ ' + b.d1; };
  /* 엑셀 하나하나가 한 줄 — 짝 있는 것 + STAR 기록 없는 것, 날짜순 */
  var rows = R.pairs.map(function(p){ return { f: p.f, b: p.b, diff: p.diff }; })
    .concat(R.rowOnly.map(function(f){ return { f: f, b: null, diff: [] }; }))
    .sort(function(x, y){ return (x.f.date || '').localeCompare(y.f.date || '') || x.f.name.localeCompare(y.f.name, 'ko'); });
  var nOk = rows.filter(function(r){ return r.b && !r.diff.length; }).length, nDiff = rows.filter(function(r){ return r.b && r.diff.length; }).length, nNo = R.rowOnly.length;
  var nOnly = R.starOnly.length;
  var h = '<div style="font-size:14px;margin:.2rem 0 .8rem;line-height:1.8">'
    + '<b>기준 = 작업 엑셀(정산 파일) ' + R.files.length + '개</b> · STAR 기록 ' + R.from.slice(5) + ' ~ ' + R.to.slice(5) + '<br>'
    + good + ' ' + nOk + '개 · ' + (nDiff ? bad('수량 다름 ' + nDiff + '개') : '수량 다름 0') + ' · ' + (nNo ? bad('STAR 기록 없음 ' + nNo + '개') : 'STAR 기록 없음 0')
    + ' │ ' + (nOnly ? warn('엑셀에 없는 STAR 변동 ' + nOnly + '건') : '엑셀에 없는 STAR 변동 0') + '</div>';

  /* ① 엑셀 기준 점검 */
  h += '<div class="sec-note" style="margin:.4rem 0 .3rem"><b>① 작업 엑셀 기준 점검</b> — 엑셀마다 STAR 재고관리에 같은 입출고가 들어갔는지 (바코드별 수량 비교, 차이 = STAR − 엑셀)</div>'
    + '<div style="overflow-x:auto"><table class="ftbl"><thead><tr><th>작업 엑셀 (기준)</th><th></th><th class="n">엑셀 수량</th><th class="n">이름에 적은 수량</th><th>STAR 기록</th><th class="n">STAR 수량</th><th class="n">STAR − 엑셀</th><th>결과</th></tr></thead><tbody>'
    + rows.map(function(r){
      var f = r.f, b = r.b, nqBad = f.nameQty != null && f.nameQty !== f.total;
      var head = '<td>' + esc(f.name) + '<div class="sm">' + (f.dir ? esc(f.kind) : '') + (f.date ? ' · ' + esc(f.date) : '') + ' · ' + Object.keys(f.items).length + '종</div></td><td>' + (f.dir ? dirL(f.dir) : '') + '</td>'
        + '<td class="n">' + n(f.total) + '</td><td class="n">' + (f.nameQty == null ? '' : (nqBad ? bad(n(f.nameQty)) : n(f.nameQty))) + '</td>';
      if (!f.dir) return '<tr class="flag">' + head + '<td colspan="4">' + bad('엑셀 모양을 못 읽음 — 대화창에 알려 주세요') + '</td></tr>';
      if (!b) return '<tr class="flag">' + head + '<td>—</td><td class="n">0</td><td class="n">' + sg(-f.total) + '</td><td>' + bad('✘ STAR 기록 없음') + '<div class="sm">엑셀대로 작업했다면 STAR 재고에 ' + (f.dir === 'in' ? '입고' : '출고') + ' 반영이 빠짐</div></td></tr>';
      var more = 0, less = 0; r.diff.forEach(function(d){ if (d.bq > d.fq) more += d.bq - d.fq; else less += d.fq - d.bq; });
      var res = !r.diff.length ? good : bad('✘ 바코드 ' + r.diff.length + '개 다름')
        + (more ? '<div class="sm">STAR 가 ' + n(more) + '개 많음 — 엑셀에 없는 작업이면 <b>청구 누락</b>, 아니면 임의 변동</div>' : '')
        + (less ? '<div class="sm">STAR 가 ' + n(less) + '개 적음 — 엑셀만큼 재고 반영 안 됨</div>' : '');
      var det = r.diff.length ? '<tr class="flag"><td colspan="8"><details><summary style="cursor:pointer">다른 바코드 ' + r.diff.length + '개 보기</summary>'
        + '<table class="ftbl" style="min-width:0;margin-top:.3rem"><thead><tr><th>바코드</th><th>상품</th><th class="n">엑셀</th><th class="n">STAR</th><th class="n">STAR − 엑셀</th></tr></thead><tbody>'
        + r.diff.map(function(d){ return '<tr><td style="font-family:var(--mo)">' + esc(d.bc) + '</td><td>' + esc(d.name) + '</td><td class="n">' + n(d.fq) + '</td><td class="n">' + n(d.bq) + '</td><td class="n">' + (d.bq > d.fq ? warn(sg(d.bq - d.fq)) : sg(d.bq - d.fq)) + '</td></tr>'; }).join('')
        + '</tbody></table></details></td></tr>' : '';
      return '<tr' + (r.diff.length ? ' class="flag"' : '') + '>' + head
        + '<td>' + esc(b.name) + '<div class="sm">' + esc(b.src) + ' · ' + esc(span(b)) + ' · ' + n(b.n) + '줄' + (b.def ? ' · 불량 ' + n(b.def) + '(별도)' : '') + '</div></td>'
        + '<td class="n">' + n(b.total) + '</td><td class="n">' + (b.total === f.total ? '0' : (b.total > f.total ? warn(sg(b.total - f.total)) : bad(sg(b.total - f.total)))) + '</td><td>' + res + '</td></tr>' + det;
    }).join('') + '</tbody></table></div>';

  /* ② 엑셀에 없는 STAR 변동 */
  h += '<div class="sec-note" style="margin:1rem 0 .3rem"><b>② 엑셀에 없는 STAR 변동 (' + esc(ymLabel(YM)) + ')</b> — STAR 재고는 움직였는데 작업 엑셀이 없음. '
    + '실제 작업이면 <b>엑셀이 빠져 받을 돈을 놓친 것</b>, 아니면 실작업과 별개인 <b>임의 변동</b>(잘못 올림·되돌림·재고 정리) — 어느 쪽인지 확인</div>'
    + (nOnly ? '<div style="overflow-x:auto"><table class="ftbl"><thead><tr><th>날짜</th><th></th><th>STAR 기록</th><th class="n">수량</th><th class="n">줄</th><th>메모</th></tr></thead><tbody>'
      + R.starOnly.map(function(b){ return '<tr class="flag"><td style="white-space:nowrap">' + esc(span(b)) + '</td><td>' + dirL(b.dir) + '</td><td>' + esc(b.name) + '<div class="sm">' + esc(b.src) + '</div></td>'
        + '<td class="n">' + n(b.total) + '</td><td class="n">' + n(b.n) + '</td><td>' + esc(b.note || '')
        + (b.usedBy && b.usedBy.length ? '<div class="chk warn" style="margin:.2rem 0 0;white-space:normal">💰 실제 입고 작업 — 이 입고 물건이 ' + b.usedBy.map(function(u){ return '「' + esc(u.name) + '」 ' + n(u.qty) + '개'; }).join(', ')
          + ' 로 출고됨 → <b>입고 검수 엑셀 빠짐 = 청구 누락</b>' + (b.total > b.usedBy.reduce(function(s, u){ return s + u.qty; }, 0) ? ' (나머지 ' + n(b.total - b.usedBy.reduce(function(s, u){ return s + u.qty; }, 0)) + '개는 아직 재고)' : '') + '</div>' : '')
        + (b.offset ? '<div class="chk warn" style="margin:.2rem 0 0">↔ ' + esc(b.offset.d0) + ' ' + (b.offset.dir === 'in' ? '입고' : '출고') + ' 「' + esc(b.offset.name) + '」와 바코드·수량 똑같음 — 되돌린 업로드(임의 변동)인지, 들어와서 그대로 나간 작업(청구 대상)인지</div>' : '') + '</td></tr>'; }).join('')
      + '</tbody></table></div>' : '<div class="sm">없음 ✔</div>');

  /* ③ 참고 — 스캔·조정 */
  if (R.manual.length) h += '<div class="sec-note" style="margin:1rem 0 .3rem"><b>③ 참고 — 바코드 스캔·재고 수정</b> (작업 엑셀과 짝짓지 않음 · 큰 수량이면 확인)</div><table class="ftbl" style="min-width:0"><tbody>'
    + R.manual.map(function(b){ return '<tr><td>' + esc(b.d0) + '</td><td>' + dirL(b.dir) + '</td><td>' + esc(b.name) + '</td><td class="n">' + n(b.total) + '</td><td>' + esc(b.note || '') + '</td></tr>'; }).join('') + '</tbody></table>';
  return h;
}
