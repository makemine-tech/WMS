/* ============================================================
   정산관리 — 🏢 업체 정산 탭 (settlement.html 에서 사용)

   흐름: 파일함에 올린 지난달 완료 거래내역서(표본)를 고르면 그 업체의 이번 달 작성이 시작된다.
     1) 표본을 열어(복호화) settle_stmt.js 로 분석 — 거래명세표 항목·단가·금액, 수량이 어디서 왔는지
     2) 표본 안의 데이터 시트마다 이번 달 파일함에서 짝이 될 원본 후보를 보여 준다
     3) 항목·시트마다 '이번 달 룰'(말로 적어도 됨)을 적어 저장 → 업체별 자동 계산을 여기에 붙여 나간다

   저장: settlement/vendors/{업체키} = { name, sample:{ym,id,name}, rules:{ items:{행:{name,text}}, sheets:{시트키:{name,text}}, memo }, at }
   쓰는 전역: db, YM, BOX, esc, $, toast, getBytes, WMS2FA, SETTLE_STMT, typeOf, ymLabel, fsize (settlement.html)
============================================================ */
var ALLBOX = {}, VENDORS = {}, VW = null;   /* VW = 지금 열린 작업 { vkey, name, fileId, ym, A(분석), zero } */
var STMT_CACHE = {};

function vKey(name){ return String(name || '').trim().replace(/[.#$/\[\]]/g, '_') || '_'; }
function sKey(name){ return String(name || '').replace(/[.#$/\[\]]/g, '_'); }

/* 파일함 전체(모든 달)에서 표본(거래내역서) 모으기 → 업체별 */
function samplesByVendor(){
  var g = {};
  Object.keys(ALLBOX).forEach(function(ym){
    Object.keys(ALLBOX[ym] || {}).forEach(function(id){
      var m = ALLBOX[ym][id]; if (!m || m.type !== 'statement' || m.superseded) return;
      var name = SETTLE_STMT.vendorFromFile(m.name);
      (g[name] = g[name] || []).push({ ym: ym, id: id, m: m });
    });
  });
  /* 최근 달 먼저, 같은 달이면 완료 확정본 먼저 */
  Object.keys(g).forEach(function(k){ g[k].sort(function(a, b){ return a.ym !== b.ym ? (a.ym < b.ym ? 1 : -1) : (b.m.final ? 1 : 0) - (a.m.final ? 1 : 0); }); });
  return g;
}
/* 이번 달 초안의 틀 = 정산월보다 앞 달 중 가장 최근 (없으면 맨 앞) */
function defaultSample(list){ for (var i = 0; i < list.length; i++) if (list[i].ym < YM) return list[i]; return list[0]; }

/* ── 업체 목록 정렬 (대표님 2026-10-03): 복잡성(기본)·정산액·이름, 각각 오름/내림 ──
   정산액·복잡성은 표본(지난달 거래내역서)을 한 번 열어 계산해 settlement/vendors/{키}/stat 에 저장 → 목록은 저장값으로 정렬
   복잡도 = 데이터 시트 수 × 10 + 청구 항목 수(0원 제외) + 데이터 줄 수 ÷ 1,000 */
var VSORT = (function(){ try { return JSON.parse(localStorage.getItem('settleVSort')) || { k: 'cx', d: -1 }; } catch (x) { return { k: 'cx', d: -1 }; } })();
function setVSort(k){ VSORT = VSORT.k === k ? { k: k, d: -VSORT.d } : { k: k, d: k === 'name' ? 1 : -1 }; try { localStorage.setItem('settleVSort', JSON.stringify(VSORT)); } catch (x) {} renderVendors(); }
function statOf(A, sid){
  var items = (A.items || []).filter(function(it){ return !it.zero; }).length, sh = (A.sheets || []), rows = sh.reduce(function(s, x){ return s + (x.rows || 0); }, 0);
  var t = A.totals || {}, total = t.total != null ? t.total : t.sub != null ? Math.round(t.sub * 1.1) : null;
  return { sid: sid, total: total, items: items, sheets: sh.length, rows: rows, cx: sh.length * 10 + items + Math.round(rows / 1000), at: Date.now() };
}
var STAT_BUSY = false;
function fillStats(g){   /* 저장된 값이 없거나 표본이 바뀐 업체만 하나씩 열어 계산 */
  if (STAT_BUSY) return;
  var todo = Object.keys(g).filter(function(n){ var v = VENDORS[vKey(n)], d = defaultSample(g[n]); return !(v && v.stat && v.stat.sid === d.id); });
  if (!todo.length) return;
  STAT_BUSY = true; var done = 0, el = function(){ return $('vstatMsg'); };
  todo.reduce(function(p, n){ return p.then(function(){
    var d = defaultSample(g[n]), ck = d.ym + '/' + d.id; if (el()) el().textContent = '정산액·복잡도 계산 중 ' + (++done) + '/' + todo.length + ' — ' + n;
    var go = STMT_CACHE[ck] ? Promise.resolve(STMT_CACHE[ck]) : getBytes(d.m.path).then(function(ab){ return WMS2FA.decrypt(d.m.path, d.m.iv, ab); })
      .then(function(bytes){ var A = SETTLE_STMT.analyze(XLSX.read(bytes, { type: 'array', cellFormula: true })); STMT_CACHE[ck] = A; return A; });
    return go.then(function(A){ return db.ref('settlement/vendors/' + vKey(n) + '/stat').set(statOf(A, d.id)); }).catch(function(x){ console.warn(n, x); });
  }); }, Promise.resolve()).then(function(){ STAT_BUSY = false; if (el()) el().textContent = ''; });
}
function renderVendors(){
  var box = $('tabVendors'); if (!box) return;
  if (VW) return renderWork();
  var g = samplesByVendor(), st = function(n){ var v = VENDORS[vKey(n)]; return (v && v.stat) || {}; };
  var names = Object.keys(g).sort(function(a, b){
    if (VSORT.k === 'name') return VSORT.d * a.localeCompare(b, 'ko');
    var x = st(a)[VSORT.k], y = st(b)[VSORT.k];
    if (x == null && y == null) return a.localeCompare(b, 'ko'); if (x == null) return 1; if (y == null) return -1;
    return VSORT.d * (x - y) || a.localeCompare(b, 'ko'); });
  var html = '<div class="bar"><span class="bar-t">업체 정산</span><span class="sec-note">작성할 정산월: <b>' + esc(ymLabel(YM)) + '</b> (파일함 탭에서 바꿈)</span></div>'
    + '<div class="sec-note" style="margin-bottom:.9rem">지난달 완료 거래내역서(표본)를 고르면 그 업체 정산 작성이 시작됩니다. 표본은 파일함에 올린 <b>MM월_거래내역서_업체명</b> 파일에서 자동으로 모읍니다.</div>';
  if (!names.length){
    html += '<div class="soon">아직 표본이 없습니다.<br>파일함에서 정산월을 <b>지난달</b>로 바꾸고 <b>00_정산서완료</b> 폴더의 거래내역서를 올려 주세요.</div>';
  } else {
    var sb = function(k, t){ var on = VSORT.k === k; return '<button class="btn' + (on ? ' p' : '') + '" style="padding:.3rem .7rem" onclick="setVSort(\'' + k + '\')">' + t + (on ? (VSORT.d > 0 ? ' ▲' : ' ▼') : '') + '</button>'; };
    html += '<div class="card"><div class="card-h"><span class="card-t">업체 ' + names.length + '곳</span><span class="card-s">룰이 코드에 반영된 업체는 ⚙️ 표시 · 룰은 대화창에서 요청</span></div>'
      + '<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin:-.2rem 0 .6rem"><span class="sm dim">정렬</span>' + sb('cx', '복잡성') + sb('total', '정산액') + sb('name', '이름')
      + '<span class="sm dim">· 같은 버튼을 다시 누르면 오름/내림 · 정산액·복잡성 = 지난달 표본 기준</span><span class="sm" id="vstatMsg" style="color:#fbbf24"></span></div>'
      + names.map(function(n){
        var list = g[n], v = VENDORS[vKey(n)], en = engineOf(vKey(n)), cnt = en && en.ruleList ? en.ruleList.length : 0, dft = defaultSample(list);
        var pickSel = list.length > 1 ? '<select class="tsel" id="smp_' + vKey(n) + '">' + list.map(function(x){ return '<option value="' + x.ym + '|' + x.id + '"' + (x === dft ? ' selected' : '') + '>' + esc(ymLabel(x.ym)) + ' · ' + (x.m.final ? '✅ ' : '') + esc(x.m.name) + '</option>'; }).join('') + '</select>'
          : '<span class="sm dim">' + esc(ymLabel(list[0].ym)) + ' · ' + esc(list[0].m.name) + '</span>';
        var sc = v && v.score, pc = sc ? sc.pct : null, dn = doneOf(vKey(n), YM);
        var stTag = dn ? '<span class="chk okk">✅ ' + esc(ymLabel(YM)) + ' 완료 확정 ' + esc(ftime(dn.at)) + '</span>' : '<span class="chk warn">⏳ ' + esc(ymLabel(YM)) + ' 작업 중</span>';
        var S2 = st(n), stx = S2.cx != null ? '<small style="display:block">정산액 <b>' + (S2.total != null ? won(S2.total) + '원' : '?') + '</b> · 복잡도 <b>' + S2.cx + '</b> <span class="dim">(시트 ' + S2.sheets + ' · 항목 ' + S2.items + ' · 줄 ' + won(S2.rows) + ')</span></small>' : '<small style="display:block" class="dim">정산액·복잡도 계산 대기</small>';
        return '<div class="row"><div class="ck">' + (cnt ? '⚙️' : '🏢') + '</div><div class="lb">' + esc(n) + ' ' + stTag + (cnt ? '<small>반영된 룰 ' + cnt + '개</small>' : '<small>아직 반영된 룰 없음</small>') + stx
          + (pc != null ? '<div class="vpct"><div class="wbar"><i style="width:' + pc + '%;background:' + pctColor(pc) + '"></i></div><b style="color:' + pctColor(pc) + '">정확도 ' + pc + '%</b></div>' : '') + '</div>'
          + '<div class="fi">' + pickSel + '</div>'
          + '<div class="ac"><button class="btn p" data-n="' + esc(n) + '" onclick="startVendor(this.dataset.n)">' + esc(ymLabel(YM)) + ' 작성 ▸</button></div></div>';
      }).join('') + '</div>';
  }
  box.innerHTML = html;
  if (names.length) setTimeout(function(){ fillStats(g); }, 300);
}

function startVendor(name){
  var g = samplesByVendor()[name]; if (!g || !g.length) return;
  var sel = $('smp_' + vKey(name)), pick = defaultSample(g);
  FINAL_MSG = '';
  if (sel){ var p = sel.value.split('|'); pick = g.filter(function(x){ return x.ym === p[0] && x.id === p[1]; })[0] || g[0]; }
  VW = { vkey: vKey(name), name: name, fileId: pick.id, ym: pick.ym, meta: pick.m, A: null, zero: false, err: '' };
  renderWork();
  var ck = pick.ym + '/' + pick.id;
  var go = STMT_CACHE[ck] ? Promise.resolve(STMT_CACHE[ck]) : getBytes(pick.m.path)
    .then(function(ab){ return WMS2FA.decrypt(pick.m.path, pick.m.iv, ab); })
    .then(function(bytes){ var A = SETTLE_STMT.analyze(XLSX.read(bytes, { type: 'array', cellFormula: true })); STMT_CACHE[ck] = A; return A; });
  go.then(function(A){ if (VW && VW.fileId === pick.id){ VW.A = A; renderWork(); } })
    .catch(function(e){ if (VW){ VW.err = (e && (e.code || e.message)) || String(e); renderWork(); } });
  /* 업체 기록 — 처음 열면 만든다 */
  var v = VENDORS[VW.vkey];
  if (!v || !v.sample || v.sample.id !== pick.id)
    db.ref('settlement/vendors/' + VW.vkey).update({ name: name, sample: { ym: pick.ym, id: pick.id, name: pick.m.name }, at: firebase.database.ServerValue.TIMESTAMP });
}
function closeWork(){ VW = null; renderVendors(); }

/* 표본 시트 종류 → 이번 달 파일함에서 찾을 종류 */
var KIND2BOX = { ebut_shiplist:['ebut_shiplist'], ebut_orders:['ebut_orders'], bnc_return:['bnc_courier'], bnc_courier:['bnc_courier'],
  freight:['freight'], coupang_po:['coupang_po'], p9_row:['p9_row'], ebut_stock:['ebut_stock'], jeju_stock:['jeju_stock'] };
function candidates(kind){
  if (!kind) return '';
  if (kind.key === 'cargo_store') return '<span class="chk okk">화물관리 페이지 ' + esc(ymLabel(YM)) + ' 기록</span>';
  var want = KIND2BOX[kind.key] || [];
  var hits = Object.keys(BOX).filter(function(id){ return want.indexOf(BOX[id].type) >= 0; });
  if (!hits.length) return '<span class="chk warn">' + esc(ymLabel(YM)) + ' 파일함에 없음</span>';
  return hits.map(function(id){ return '<div class="sm">📎 ' + esc(BOX[id].name) + '</div>'; }).join('');
}

function won(n){ return n == null ? '' : Math.round(n).toLocaleString('ko-KR'); }

/* ═══ 업체 설정은 코드(settle_engines.js)에만 있다 ═══
   화면에서 룰을 적는 칸은 없다 — 대표님이 대화에서 요청하면 Claude 가 settle_engines.js 에 넣는다.
   SETTLE_ENGINES[업체키] = {
     items:    { 행: 'fixed' | 'manual' | 'auto' }   📌 지난달 그대로 · ✏️ 매달 화면에서 입력 · ⚙️ 자동 계산
     sheets:   { 시트이름: 'copy' | 'skip' }          📋 이번 달 원본으로 교체 · ➖ 손대지 않음
     verified: { 행: true }                         ✅ 지난달 원본으로 지난달 완료본을 재현해 일치 확인
     opt:      { checkSheet, noYellow }             엑셀에 점검 시트 넣기 · 노란 표시 끄기
     ruleList: [ { d:'반영일', t:'룰' } ]             화면 맨 아래 '적용 룰' 목록 (번호는 순서대로)
     afterBuild(wb, ctx)                            엑셀 만들 때 업체 전용 처리
   } */
function engineOf(vkey){ return (window.SETTLE_ENGINES && window.SETTLE_ENGINES[vkey]) || window.SETTLE_AUTO || null; }   /* 전용 엔진 없으면 자동(범용) 엔진 settle_engine_auto.js */
/* 엔진 설정을 기존 계산에서 쓰던 모양 { items:{행:{mode}}, sheets:{시트키:{mode}} } 으로 */
function cfgOf(vkey){
  var e = engineOf(vkey) || {}, R = { items: {}, sheets: {} };
  Object.keys(e.items || {}).forEach(function(r){ R.items[r] = { mode: e.items[r] }; });
  Object.keys(e.sheets || {}).forEach(function(n){ R.sheets[sKey(n)] = { mode: e.sheets[n] }; });
  return R;
}

/* ═══ 정확도 ═══
   항목 단계: ⬜ 미반영 0 · ⚙️ 자동 계산 80% · 📌 고정 / ✏️ 매달 입력 100% · ✅ 지난달과 일치 100%
   항목은 지난달 금액 비중으로 가중, 데이터 시트 준비도 20% 반영. */
var LV = {
  none:   { v: 0,   ic: '⬜', t: '미반영',        c: '#3a4255' },
  auto:   { v: 0.8, ic: '⚙️', t: '자동 계산',      c: '#60a5fa' },
  fixed:  { v: 1,   ic: '📌', t: '지난달 그대로',   c: '#2dd4bf' },
  manual: { v: 1,   ic: '✏️', t: '매달 입력',      c: '#2dd4bf' },
  ok:     { v: 1,   ic: '✅', t: '지난달과 일치',   c: '#4ade80' },
  copy:   { v: 1,   ic: '📋', t: '이번 달 원본',    c: '#2dd4bf' },
  skip:   { v: 1,   ic: '➖', t: '손대지 않음',     c: '#2dd4bf' }
};
function itemLevel(it, rr, eng){
  if (eng && eng.verified && eng.verified[it.r]) return 'ok';
  if (rr && (rr.mode === 'fixed' || rr.mode === 'manual')) return rr.mode;
  if ((rr && rr.mode === 'auto') || (eng && eng.auto && eng.auto[it.r])) return 'auto';
  return 'none';
}
function sheetLevel(s, rr){ return rr && (rr.mode === 'skip' || rr.mode === 'copy') ? rr.mode : 'none'; }
function scoreOf(A, R, vkey){
  R = R || {}; var eng = engineOf(vkey);
  var items = A.items.filter(function(i){ return !i.zero; });
  var tot = items.reduce(function(a, i){ return a + Math.abs(i.amt.v || 0); }, 0);
  var by = {}, ip = 0;
  items.forEach(function(it){
    var w = tot ? Math.abs(it.amt.v || 0) / tot : 1 / Math.max(items.length, 1), k = itemLevel(it, (R.items || {})[it.r], eng);
    it._w = w; it._lv = k; ip += w * LV[k].v; by[k] = (by[k] || 0) + w;
  });
  var sheets = A.sheets.filter(function(s){ return s.rows > 0 || s.usedBy.length; }), sp = 0;
  sheets.forEach(function(s){ s._lv = sheetLevel(s, (R.sheets || {})[sKey(s.name)]); sp += LV[s._lv].v; });
  sp = sheets.length ? sp / sheets.length : 1;
  var pct = Math.round((sheets.length ? ip * 0.8 + sp * 0.2 : ip) * 100);
  var todo = items.filter(function(i){ return LV[i._lv].v < 1; }).sort(function(a, b){ return b._w - a._w; });
  return { pct: pct, items: ip, sheets: sp, by: by, todo: todo, nSheets: sheets.length };
}
function pctColor(p){ return p >= 90 ? '#4ade80' : p >= 60 ? '#60a5fa' : p >= 30 ? '#fbbf24' : '#f87171'; }
function scoreCardHtml(S, A){
  var order = ['ok', 'fixed', 'manual', 'auto', 'none'];
  var bar = order.filter(function(k){ return S.by[k]; }).map(function(k){
    return '<i style="width:' + (S.by[k] * 100).toFixed(2) + '%;background:' + LV[k].c + '" title="' + LV[k].t + ' ' + Math.round(S.by[k] * 100) + '%"></i>'; }).join('');
  var legend = order.filter(function(k){ return S.by[k]; }).map(function(k){
    return '<span><i style="background:' + LV[k].c + '"></i>' + LV[k].ic + ' ' + LV[k].t + ' ' + Math.round(S.by[k] * 100) + '%</span>'; }).join('');
  var next = S.todo.slice(0, 3).map(function(i){ return '<b>' + esc(i.name) + '</b> (' + Math.round(i._w * 100) + '%)'; }).join(', ');
  return '<div class="sc-top"><div class="sc-pct" style="color:' + pctColor(S.pct) + '">' + S.pct + '<small>%</small></div>'
    + '<div class="sc-main"><div class="sc-t">정확도 <span class="dim">— 코드에 반영된 정도 · 항목은 지난달 금액 비중으로 가중' + (S.nSheets ? ' · 데이터 시트 20%' : '') + '</span></div>'
    + '<div class="sc-bar">' + bar + '</div><div class="sc-leg">' + legend + '</div>'
    + '<div class="sm">항목 ' + Math.round(S.items * 100) + '%' + (S.nSheets ? ' · 데이터 시트 ' + Math.round(S.sheets * 100) + '%' : '')
    + ' · 지난달 소계 ' + won(A.totals.sub || (A.totals.total ? A.totals.total / 1.1 : null)) + '원 · 합계 ' + won(A.totals.total) + '원</div>'
    + (next ? '<div class="sm" style="margin-top:.3rem">아직 미반영 중 큰 것: ' + next + '</div>' : '<div class="sm" style="margin-top:.3rem;color:var(--g)">모든 항목이 반영되었습니다</div>')
    + '<div class="sc-help dim">⬜ 미반영 0 · ⚙️ 자동 계산 80% · 📌 지난달 그대로 / ✏️ 매달 입력 100% · ✅ 지난달과 일치 100% — 반영은 대화창에서 요청</div></div></div>';
}
function refreshScore(){ if (VW && VW.A) renderWork(); }
function lvChip(kind, key, k){ return '<span class="lvchip" style="border-color:' + LV[k].c + '">' + LV[k].ic + ' ' + LV[k].t + '</span>'; }
function saveScore(pct){
  var v = VENDORS[VW.vkey] || {}, sig = VW.vkey + '|' + YM + '|' + pct;
  if (VW._savedScore === sig) return;            /* 저장 → 다시 그림 → 또 저장 되풀이 막기 */
  VW._savedScore = sig;
  if (v.score && v.score.pct === pct && v.score.ym === YM) return;
  db.ref('settlement/vendors/' + VW.vkey + '/score').set({ pct: pct, ym: YM, at: firebase.database.ServerValue.TIMESTAMP });
}
/* 화면 맨 아래 — 이 업체에 반영된 룰 (Claude 가 settle_engines.js 에 적어 둔 것) */
function ruleListHtml(){
  var e = engineOf(VW.vkey), L = (e && e.ruleList) || [];
  return '<div class="card-h"><span class="card-t">📜 ' + esc(VW.name) + ' 적용 룰</span><span class="card-s">대화창에서 요청해 코드에 반영된 룰 · 이 업체는 이대로 고정해서 움직입니다</span></div>'
    + (L.length ? '<ol class="rulelist">' + L.map(function(x){ return '<li>' + esc(x.t) + (x.d ? ' <span class="dim">(' + esc(x.d) + ')</span>' : '') + '</li>'; }).join('') + '</ol>'
      : '<div class="empty-s">아직 반영된 룰이 없습니다. 대화창에서 "' + esc(VW.name) + ' 룰: …" 처럼 요청하시면 여기에 1, 2, 3… 으로 적힙니다.</div>');
}

function renderWork(){
  var box = $('tabVendors'); if (!box || !VW) return;
  var R = cfgOf(VW.vkey), A = VW.A;
  var head = '<div class="bar"><button class="btn" onclick="closeWork()">← 업체 목록</button>'
    + '<span class="bar-t">' + esc(VW.name) + ' · ' + esc(ymLabel(YM)) + ' 정산 작성</span>'
    + '<span class="sec-note">표본: ' + esc(ymLabel(VW.ym)) + ' ' + esc(VW.meta.name) + '</span></div>';
  if (VW.err){ box.innerHTML = head + '<div class="soon">표본을 열지 못했습니다: ' + esc(VW.err) + '</div>'; return; }
  if (!A){ box.innerHTML = head + '<div class="soon">표본을 여는 중… (암호 풀고 엑셀 읽기)</div>'; return; }
  var S = scoreOf(A, R, VW.vkey);
  var items = (VW.zero ? A.items : A.items.filter(function(i){ return !i.zero; })).slice();
  if (VW.sortW) items.sort(function(a, b){ return (b._w || 0) - (a._w || 0); });
  var itemRows = items.map(function(it){
    var k = it._lv || 'none';
    return '<tr' + (it.zero ? ' class="dimrow"' : '') + '><td class="dim">' + it.r + '</td>'
      + '<td><b>' + esc(it.name) + '</b>' + (it.size ? '<div class="dim">' + esc(it.size) + '</div>' : '') + (it.date ? '<div class="dim">' + esc(it.date) + '</div>' : '') + '</td>'
      + '<td>' + (it.zero ? '' : lvChip('i', it.r, k)) + '</td>'
      + '<td class="n">' + won(it.qty.v) + '</td><td class="n">' + won(it.price.v) + '</td><td class="n">' + won(it.amt.v) + '</td>'
      + '<td class="n">' + (it.zero ? '' : '<div class="wbar"><i style="width:' + Math.max(2, Math.round((it._w || 0) * 100)) + '%"></i></div>' + (Math.round((it._w || 0) * 1000) / 10) + '%') + '</td>'
      + '<td class="src"><span class="srck ' + it.qty.src.kind + '">' + esc(it.qty.src.text) + '</span>' + (it.note ? '<div class="dim">' + esc(it.note) + '</div>' : '') + '</td></tr>';
  }).join('');
  var sheetRows = A.sheets.map(function(s){
    var k = s._lv;
    return '<tr><td><b>' + esc(s.name) + '</b><div class="dim">' + s.rows.toLocaleString() + '행</div></td>'
      + '<td>' + (k ? lvChip('s', sKey(s.name), k) : '<span class="dim">-</span>') + '</td>'
      + '<td>' + (s.kind ? esc(s.kind.label) : '<span class="dim">?</span>') + '<div class="dim" style="font-size:11px">' + esc(s.headers.slice(0, 8).join(' · ')) + '</div></td>'
      + '<td class="dim">' + (s.usedBy.length ? s.usedBy.map(function(x){ return x + '행'; }).join(', ') : '-') + '</td>'
      + '<td>' + candidates(s.kind) + '</td></tr>';
  }).join('');
  box.innerHTML = head
    + '<div class="card sc" id="scoreCard">' + scoreCardHtml(S, A) + '</div>'
    + '<div class="card" id="buildCard">' + buildCardHtml(A, R) + '</div>'
    + '<div class="card"><div class="card-h"><span class="card-t">① 거래명세표 항목 (표본)</span><span class="card-s">지난달 수량이 어디서 왔는지 · 상태는 코드 반영 정도</span>'
    + '<label class="dim" style="margin-left:auto;font-size:12px"><input type="checkbox" ' + (VW.sortW ? 'checked' : '') + ' onchange="VW.sortW=this.checked;renderWork()"> 비중 큰 순</label>'
    + '<label class="dim" style="font-size:12px"><input type="checkbox" ' + (VW.zero ? 'checked' : '') + ' onchange="VW.zero=this.checked;renderWork()"> 0원 줄도 보기</label></div>'
    + '<div style="overflow-x:auto"><table class="ftbl wk"><thead><tr><th>행</th><th>내역</th><th>상태</th><th style="text-align:right">수량</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th><th style="text-align:right">비중</th><th>수량 출처 · 비고</th></tr></thead><tbody>' + itemRows + '</tbody></table></div></div>'
    + '<div class="card"><div class="card-h"><span class="card-t">② 데이터 시트 (표본)</span><span class="card-s">표본 안의 근거 시트 · 이번 달 파일함에서 짝이 될 원본</span></div>'
    + (sheetRows ? '<div style="overflow-x:auto"><table class="ftbl wk"><thead><tr><th>시트</th><th>상태</th><th>종류 · 제목줄</th><th>쓰는 항목</th><th>' + esc(ymLabel(YM)) + ' 원본</th></tr></thead><tbody>' + sheetRows + '</tbody></table></div>' : '<div class="empty-s">데이터 시트 없음</div>') + '</div>'
    + '<div class="card rulecard">' + ruleListHtml() + '</div>'
    + '<div class="card" id="finalCard">' + finalCardHtml() + '</div>';
  saveScore(S.pct);
}
