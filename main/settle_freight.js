/* ============================================================
   정산 파일함 — 화물·용차비 청구서 확인 (settlement.html 에서 사용)

   청구서 파일의 두 시트:
     결제금액명세서 = 원본 — 배차업체에 실제로 주는 금액(비용)
     Sheet1        = 업체(화주)에 청구할 금액 — 상황에 따라 일부 건만 커미션을 붙여 올린다
   정산에는 항상 Sheet1 을 쓰고, 원본 금액(r.cost)은 비교용으로 나란히 보여 준다.

   업체로 쪼개 청구하면 "같은 장소인데 왜 날짜마다 금액이 달라요?" 라는 질문이 나올 수 있어서,
   ① 같은 업체 · 같은 구간(출발지→도착지·차종)인데 청구 금액이 다른 묶음을 모아 보여 주고
      날짜·내용·원본·청구 금액 옆에 '정산 금액'을 적으면 그 금액으로 정산된다.
   ② 그 밖에 — 지난달까지 이 구간에서 낸 적 없는 금액, 합계금액 빈칸/불일치 — 는 건별로 맞음/금액 수정.
   ③ 원본에만 있는 건(청구 안 한 회차 등)은 참고로 보여 준다.

   저장: settlement/freight/{ym}/{fileId}/chk/{행번호} = { st:'ok'|'fix', fix, memo, by, at }
         정산 금액 = fix(있으면) 아니면 Sheet1 금액. 다음 달 비교 기준도 이 금액.
   쓰는 전역: YM, db, me, esc, $, SETTLE_FREIGHT (settlement.html)
============================================================ */
var FREIGHT = {};                       /* settlement/freight 전체 — settlement.html 이 채운다 */
var FR_OPEN = null, FR_EXP = {}, FR_DRAFT = {};

/* 업체 이름 = 괄호 앞, 띄어쓰기 없이. 청구서에 나온 다른 업체 이름으로 시작하면 그 업체
   (포인트나인크루(곡물)·포인트나인크루곡물·포인트나인크루 당쉼 → 포인트나인크루) */
var FR_BASES = null, FR_BASES_OF = null;
function frRaw(v){ return String(v || '').replace(/\(.*$/, '').replace(/\s+/g, ''); }
function frBases(){
  if (FR_BASES_OF === FREIGHT && FR_BASES) return FR_BASES;
  var s = {};
  Object.keys(FREIGHT).forEach(function(m){ Object.keys(FREIGHT[m] || {}).forEach(function(fid){ var F = FREIGHT[m][fid] || {}, ch = F.chk || {};
    (F.rows || []).forEach(function(r, i){ var b = frRaw(frVendor(r, ch[i])); if (b.length >= 2) s[b] = 1; }); }); });
  FR_BASES = Object.keys(s).sort(function(a, b){ return a.length - b.length; }); FR_BASES_OF = FREIGHT;
  return FR_BASES;
}
function frBase(v){
  var b = frRaw(v); if (!b) return '(업체명 없음)';
  var L = frBases(); for (var i = 0; i < L.length && L[i].length < b.length; i++) if (b.indexOf(L[i]) === 0) return L[i];
  return b;
}
function frVendor(r, c){ return (c && c.vendor) || r.vendor || ''; }   /* 업체 지정한 건은 그 업체로 */
function frFinal(r, c){ return c && c.st === 'fix' && c.fix != null ? +c.fix : +r.amt || 0; }
function frWon(n){ return (+n || 0).toLocaleString('ko-KR'); }
function frDay(d){ var s = String(d || ''); if (s.length < 10) return s; return (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) + ' (' + '일월화수목금토'.charAt(new Date(s + 'T00:00:00Z').getUTCDay()) + ')'; }
function frMode(arr){ var c = {}, best = null; arr.forEach(function(v){ c[v] = (c[v] || 0) + 1; if (best == null || c[v] > c[best] || (c[v] === c[best] && +v < +best)) best = v; }); return best == null ? null : { v: +best, n: c[best], all: c }; }

/* ym 이전 달들의 구간별 정산 금액 */
function frHistory(ym){
  var h = {};
  Object.keys(FREIGHT).forEach(function(m){ if (m >= ym) return;
    Object.keys(FREIGHT[m] || {}).forEach(function(fid){ var F = FREIGHT[m][fid] || {}, ch = F.chk || {};
      (F.rows || []).forEach(function(r, i){ var k = SETTLE_FREIGHT.key(r); (h[k] = h[k] || []).push(frFinal(r, ch[i])); }); }); });
  return h;
}

/* 한 파일 분석 → { F, groups, others, costOnly, left, total } */
function frAnalyze(ym, fid){
  var F = (FREIGHT[ym] || {})[fid]; if (!F) return null;
  var rows = F.rows || [], chk = F.chk || {}, hist = frHistory(ym);
  /* ① 같은 업체·구간 묶음 */
  var g = {};
  rows.forEach(function(r, i){ var k = frBase(r.vendor) + '|' + SETTLE_FREIGHT.key(r); (g[k] = g[k] || []).push(i); });
  var groups = [], inGroup = {};
  Object.keys(g).forEach(function(k){
    var idx = g[k], amts = {};
    idx.forEach(function(i){ var a = +rows[i].amt || 0; amts[a] = (amts[a] || 0) + 1; });
    if (Object.keys(amts).length < 2) return;
    idx.forEach(function(i){ inGroup[i] = 1; });
    var r0 = rows[idx[0]];
    groups.push({ key: k, vendor: frBase(r0.vendor), from: r0.from, to: r0.to, car: r0.car, idx: idx, amts: amts,
      mode: frMode(idx.map(function(i){ return +rows[i].amt || 0; })).v,
      done: idx.every(function(i){ return !!chk[i]; }) });
  });
  groups.sort(function(a, b){ return (a.done - b.done) || (b.idx.length - a.idx.length); });
  /* ② 그 밖의 확인 */
  var others = [];
  rows.forEach(function(r, i){
    var why = [], k = SETTLE_FREIGHT.key(r), amt = +r.amt || 0;
    if (!inGroup[i] && hist[k] && hist[k].length){
      var seen = {}; hist[k].forEach(function(v){ seen[v] = (seen[v] || 0) + 1; });
      if (!seen[amt]){
        var near = Object.keys(seen).map(Number).sort(function(a, b){ return Math.abs(a - amt) - Math.abs(b - amt); })[0], d = amt - near;
        why.push((d > 0 ? '▲ ' : '▼ ') + frWon(Math.abs(d)) + '원 ' + (d > 0 ? '비쌈' : '쌈') + ' — 지난달까지 이 구간 금액: '
          + Object.keys(seen).map(Number).sort(function(a, b){ return a - b; }).map(function(v){ return frWon(v) + '원(' + seen[v] + '회)'; }).join(', '));
      }
    }
    var sum = amt + (+r.etc || 0);
    if (r.tot == null) why.push('합계금액이 비어 있음 — 금액+기타 = ' + frWon(sum) + '원');
    else if (+r.tot !== sum) why.push('합계금액 ' + frWon(r.tot) + '원 ≠ 금액+기타 ' + frWon(sum) + '원');
    /* 업체명 빈칸 — 어느 업체 정산에도 안 들어간다 (원본 결제금액명세서의 업체명을 제안) */
    var noVendor = !String(r.vendor || '').trim();
    if (noVendor && !(chk[i] && chk[i].vendor)) why.push('업체명이 비어 있어 어느 업체 정산에도 안 들어갑니다' + (r.costVendor ? ' — 원본(결제금액명세서)에는 「' + r.costVendor + '」' : ''));
    if (why.length || (noVendor && chk[i] && chk[i].vendor)) others.push({ i: i, why: why, done: !!chk[i], noVendor: noVendor });
  });
  var left = groups.filter(function(x){ return !x.done; }).length + others.filter(function(x){ return !x.done; }).length;
  var total = rows.reduce(function(a, r, i){ return a + frFinal(r, chk[i]) + (+r.etc || 0); }, 0);
  return { F: F, rows: rows, chk: chk, groups: groups, others: others, costOnly: F.costOnly || [], left: left, total: total };
}

/* 파일함 목록에 붙는 한 줄 */
function freightBadge(fid){
  var A = frAnalyze(YM, fid); if (!A) return '<div class="sm dim">확인 정보 없음 — 파일을 다시 올리면 생깁니다</div>';
  var lab = A.F.src === 'cost' ? '<span class="chk warn">⚠ Sheet1 없음 — ' + esc(A.F.sheet || '') + '(배차업체 지급액) 기준</span> '
    : '<span class="dim">' + esc(A.F.sheet || 'Sheet1') + '(업체 청구용) 기준 · </span>';
  var all = A.groups.length + A.others.length;
  return '<div class="sm">' + lab + A.rows.length + '건 · 정산 반영 합계 ' + frWon(A.total) + '원'
    + (all ? (A.left ? '<span class="chk warn">확인 필요 ' + A.left + '건</span>' : '<span class="chk okk">확인 완료 ' + all + '건</span>') : '<span class="chk okk">의심 건 없음</span>')
    + ' <button class="btn" style="margin-left:.3rem" onclick="openFreight(\'' + fid + '\')">확인 ▸</button></div>';
}

function openFreight(fid){ FR_OPEN = fid; FR_EXP = {}; FR_DRAFT = {}; drawFreight(); }
function closeFreight(){ FR_OPEN = null; var m = $('frModal'); if (m) m.remove(); }

function drawFreight(){
  if (!FR_OPEN) return;
  var A = frAnalyze(YM, FR_OPEN); if (!A){ closeFreight(); return; }
  var m = $('frModal');
  var keepScroll = m && m.querySelector('.mbody') ? m.querySelector('.mbody').scrollTop : 0;
  if (!m){ m = document.createElement('div'); m.id = 'frModal'; m.className = 'modal'; m.onclick = function(e){ if (e.target === m) closeFreight(); }; document.body.appendChild(m); }
  var rows = A.rows, chk = A.chk;
  var content = function(r){ return esc([r.qty, r.item].filter(Boolean).join(' ')) + (r.note ? ' · ' + esc(r.note) : '') + (r.extra ? '<br><span class="dim">+ ' + esc(r.extra) + '</span>' : ''); };
  var costCell = function(r){ return r.cost == null ? '<span class="dim">—</span>' : frWon(r.cost); };

  /* ① 묶음 카드 */
  var groupsHtml = A.groups.map(function(G, gi){
    var amtTxt = Object.keys(G.amts).map(Number).sort(function(a, b){ return a - b; }).map(function(a){ return frWon(a) + '원 ' + G.amts[a] + '건'; }).join(' · ');
    var collapse = G.idx.length > 6 && !FR_EXP[gi];
    var shown = collapse ? G.idx.filter(function(i){ return (+rows[i].amt || 0) !== G.mode || (FR_DRAFT[i] != null && +FR_DRAFT[i] !== G.mode); }) : G.idx;
    var hidden = G.idx.length - shown.length;
    var tr = shown.map(function(i){
      var r = rows[i], c = chk[i], v = FR_DRAFT[i] != null ? FR_DRAFT[i] : frFinal(r, c);
      var diff = +v !== (+r.amt || 0);
      return '<tr><td style="white-space:nowrap">' + frDay(r.d) + '</td><td>' + content(r) + '</td>'
        + '<td class="n">' + costCell(r) + '</td>'
        + '<td class="n">' + frWon(r.amt) + ((r.cost != null && r.cost !== +r.amt) ? '<div class="why" style="font-size:10.5px">원본+' + frWon(r.amt - r.cost) + '</div>' : '') + '</td>'
        + '<td class="n"><input class="famt' + (diff ? ' chg' : '') + '" type="number" step="1000" value="' + v + '" oninput="FR_DRAFT[' + i + ']=this.value;this.classList.toggle(\'chg\',+this.value!==' + (+r.amt || 0) + ')"></td></tr>';
    }).join('');
    if (hidden) tr += '<tr><td colspan="5" class="dim" style="text-align:center">청구 ' + frWon(G.mode) + '원인 건 ' + hidden + '건 더 있음 '
      + '<button class="btn" onclick="FR_EXP[' + gi + ']=1;drawFreight()">펼치기</button></td></tr>';
    var quick = Object.keys(G.amts).map(Number).sort(function(a, b){ return a - b; })
      .map(function(a){ return '<button class="btn" onclick="frSetAll(' + gi + ',' + a + ')">모두 ' + frWon(a) + '원</button>'; }).join(' ');
    return '<div class="fgrp' + (G.done ? ' done' : '') + '">'
      + '<div class="fgh"><span>' + (G.done ? '✅' : '⚠️') + ' <b>' + esc(G.vendor) + '</b> · ' + esc(G.from) + ' → ' + esc(G.to) + ' · ' + esc(G.car) + '</span>'
      + '<span class="dim">' + G.idx.length + '건 · 청구 금액 ' + amtTxt + '</span></div>'
      + '<div style="overflow-x:auto"><table class="ftbl g"><thead><tr><th>날짜</th><th>내용</th><th style="text-align:right" title="결제금액명세서 — 배차업체 지급액">원본</th><th style="text-align:right" title="Sheet1 — 업체 청구 금액">청구</th><th style="text-align:right">정산 금액</th></tr></thead><tbody>' + tr + '</tbody></table></div>'
      + '<div class="fgf"><span class="dim">빠른 맞추기</span> ' + quick + '<span style="flex:1"></span>'
      + (G.done ? '<button class="btn r" onclick="frUndoGroup(' + gi + ')">다시 고치기</button> ' : '')
      + '<button class="btn p" onclick="frSaveGroup(' + gi + ')">' + (G.done ? '고친 대로 저장' : '이 금액으로 정산') + '</button></div></div>';
  }).join('');

  /* ② 그 밖의 확인 */
  var othersHtml = A.others.map(function(x){
    var r = rows[x.i], c = chk[x.i], fin = frFinal(r, c);
    var state = c ? (c.vendor ? '<div class="why g">🏷 업체 「' + esc(c.vendor) + '」 로 지정</div>' : '')
      + (c.st === 'fix' ? '<div class="why g">✎ ' + frWon(fin) + '원으로 수정' + (c.memo ? ' · ' + esc(c.memo) : '') + '</div>' : (c.vendor ? '' : '<div class="why g">✔ 이대로 맞음</div>')) : '';
    return '<tr class="' + (c ? 'done' : 'flag') + '"><td style="white-space:nowrap">' + frDay(r.d) + '</td>'
      + '<td>' + esc(r.from) + ' → ' + esc(r.to) + '<div class="dim">' + esc(r.car) + ' · ' + content(r) + '</div></td>'
      + '<td>' + (x.noVendor ? (c && c.vendor ? esc(c.vendor) : '<span class="why">(빈칸)</span>') + '<div><button class="btn" onclick="frMark(' + x.i + ',\'vendor\')">업체 지정</button></div>' : esc(r.vendor)) + '</td>'
      + '<td class="n">' + costCell(r) + '</td>'
      + '<td class="n">' + (c && c.st === 'fix' ? '<span class="strike">' + frWon(r.amt) + '</span><br>' + frWon(fin) : frWon(r.amt)) + (r.etc ? '<div class="dim">+기타 ' + frWon(r.etc) + '</div>' : '') + '</td>'
      + '<td>' + x.why.map(function(w){ return '<div class="why">' + esc(w) + '</div>'; }).join('') + state + '</td>'
      + '<td style="white-space:nowrap"><button class="btn" onclick="frMark(' + x.i + ',\'ok\')">맞음</button> <button class="btn" onclick="frMark(' + x.i + ',\'fix\')">금액 수정</button>'
      + (c ? ' <button class="btn r" onclick="frMark(' + x.i + ',\'undo\')">되돌리기</button>' : '') + '</td></tr>';
  }).join('');

  /* ③ 원본에만 있는 건 */
  var onlyHtml = A.costOnly.map(function(r){
    return '<tr><td style="white-space:nowrap">' + frDay(r.d) + '</td><td>' + esc(r.from) + ' → ' + esc(r.to) + ' · ' + esc(r.car) + '<div class="dim">' + content(r) + '</div></td><td>' + esc(r.vendor) + '</td><td class="n">' + frWon(r.amt) + '</td></tr>';
  }).join('');

  var gLeft = A.groups.filter(function(x){ return !x.done; }).length, oLeft = A.others.filter(function(x){ return !x.done; }).length;
  m.innerHTML = '<div class="mbox"><div class="mhd">🚚 ' + esc(A.F.file) + '<span class="sp"></span><span class="dim" style="font-size:12px;font-weight:500">정산 반영 합계 ' + frWon(A.total) + '원</span>'
    + '<button class="btn" onclick="closeFreight()">닫기</button></div><div class="mbody">'
    + '<div class="sec-note" style="margin-bottom:.8rem">' + (A.F.src === 'cost'
        ? '<b style="color:var(--y)">⚠ 이 파일에 Sheet1(업체 청구용)이 없어 ' + esc(A.F.sheet || '') + '(배차업체 지급액)으로 읽었습니다.</b> '
        : '<b>' + esc(A.F.sheet || 'Sheet1') + '</b>(업체 청구용) 금액으로 정산하고, <b>원본</b>은 결제금액명세서(배차업체 지급액)입니다. ')
      + '정산 금액을 고치면 그 금액으로 업체 정산서가 작성되고, 다음 달부터 비교 기준이 됩니다.</div>'
    + '<div class="fsec"><div class="fsec-t">① 같은 업체 · 같은 구간인데 금액이 다른 건 <span class="dim">— 업체가 "왜 다르냐" 물을 수 있는 건 · '
      + (A.groups.length ? (gLeft ? '확인 필요 ' + gLeft + '묶음 / ' + A.groups.length : '모두 정리됨 ' + A.groups.length + '묶음') : '없음') + '</span></div>'
      + (groupsHtml || '<div class="empty-s">없습니다.</div>') + '</div>'
    + '<div class="fsec"><div class="fsec-t">② 그 밖의 확인 <span class="dim">— 지난달까지 낸 적 없는 금액 · 합계금액 문제 · ' + (A.others.length ? (oLeft ? '확인 필요 ' + oLeft + '건 / ' + A.others.length : '모두 확인 ' + A.others.length + '건') : '없음') + '</span></div>'
      + (othersHtml ? '<div style="overflow-x:auto"><table class="ftbl"><thead><tr><th>날짜</th><th>구간·내용</th><th>업체</th><th style="text-align:right">원본</th><th style="text-align:right">청구</th><th>확인 내용</th><th></th></tr></thead><tbody>' + othersHtml + '</tbody></table></div>' : '<div class="empty-s">없습니다.</div>') + '</div>'
    + (onlyHtml ? '<div class="fsec"><div class="fsec-t">③ 원본에만 있는 건 <span class="dim">— 결제금액명세서엔 있는데 Sheet1 에는 없음 (청구 안 함) · 참고용</span></div>'
      + '<div style="overflow-x:auto"><table class="ftbl" style="min-width:600px"><thead><tr><th>날짜</th><th>구간·내용</th><th>업체</th><th style="text-align:right">원본 금액</th></tr></thead><tbody>' + onlyHtml + '</tbody></table></div></div>' : '')
    + '</div></div>';
  if (keepScroll) m.querySelector('.mbody').scrollTop = keepScroll;
}

/* 묶음 전체를 한 금액으로 */
function frSetAll(gi, amt){
  var A = frAnalyze(YM, FR_OPEN), G = A && A.groups[gi]; if (!G) return;
  G.idx.forEach(function(i){ FR_DRAFT[i] = amt; });
  drawFreight();
}
/* 묶음 저장 — 청구 금액과 같으면 '맞음', 다르면 '수정' */
function frSaveGroup(gi){
  var A = frAnalyze(YM, FR_OPEN), G = A && A.groups[gi]; if (!G) return;
  var up = {}, by = (me && me.email) || '', changed = 0;
  for (var x = 0; x < G.idx.length; x++){
    var i = G.idx[x], r = A.rows[i], raw = FR_DRAFT[i] != null ? FR_DRAFT[i] : frFinal(r, A.chk[i]);
    var v = Number(String(raw).replace(/[^0-9.-]/g, ''));
    if (String(raw).trim() === '' || !isFinite(v)){ alert(frDay(r.d) + ' 정산 금액을 숫자로 입력하세요'); return; }
    if (v === (+r.amt || 0)) up[i] = { st: 'ok', by: by, at: firebase.database.ServerValue.TIMESTAMP };
    else { changed++; up[i] = { st: 'fix', fix: v, memo: '같은 구간 금액 맞춤', by: by, at: firebase.database.ServerValue.TIMESTAMP }; }
  }
  db.ref('settlement/freight/' + YM + '/' + FR_OPEN + '/chk').update(up).then(function(){
    G.idx.forEach(function(i){ delete FR_DRAFT[i]; });
    toast(changed ? changed + '건 금액을 고쳐 저장했습니다' : '청구 금액 그대로 확인했습니다');
  }).catch(function(e){ alert('저장 실패: ' + ((e && e.message) || e)); });
}
function frUndoGroup(gi){
  var A = frAnalyze(YM, FR_OPEN), G = A && A.groups[gi]; if (!G) return;
  var up = {}; G.idx.forEach(function(i){ up[i] = null; delete FR_DRAFT[i]; });
  db.ref('settlement/freight/' + YM + '/' + FR_OPEN + '/chk').update(up);
}
/* 건별 맞음 / 금액 수정 / 되돌리기 */
function frMark(i, act){
  var path = 'settlement/freight/' + YM + '/' + FR_OPEN + '/chk/' + i;
  if (act === 'undo') return db.ref(path).remove();
  var r = FREIGHT[YM][FR_OPEN].rows[i];
  if (act === 'vendor'){   /* 업체명 빈칸 → 업체 지정 (금액 확인 상태는 그대로 둠) */
    var cur = ((FREIGHT[YM][FR_OPEN].chk || {})[i]) || {};
    var nm = prompt(r.from + ' → ' + r.to + ' · ' + r.car + ' · ' + frWon(r.amt) + '원\n이 건을 어느 업체로 정산할까요? (청구서 업체명 그대로, 예: 포인트나인크루(곡물))', cur.vendor || r.costVendor || '');
    if (nm == null) return;
    nm = nm.trim();
    return db.ref(path).set(Object.assign({}, cur, { st: cur.st || 'ok', vendor: nm || null, by: (me && me.email) || '', at: firebase.database.ServerValue.TIMESTAMP }));
  }
  var rec = { st: act, by: (me && me.email) || '', at: firebase.database.ServerValue.TIMESTAMP };
  var keep = ((FREIGHT[YM][FR_OPEN].chk || {})[i] || {}).vendor; if (keep) rec.vendor = keep;   /* 지정한 업체는 유지 */
  if (act === 'fix'){
    var v = prompt(r.from + ' → ' + r.to + ' · ' + r.car + '\n청구 금액 ' + frWon(r.amt) + '원' + (r.cost != null ? ' (원본 ' + frWon(r.cost) + '원)' : '') + '\n\n정산에 쓸 금액을 입력하세요 (기타 금액 제외)', String(r.amt));
    if (v == null) return;
    var n = Number(String(v).replace(/[^0-9.-]/g, '')); if (!isFinite(n) || String(v).trim() === ''){ alert('숫자로 입력하세요'); return; }
    rec.fix = n; rec.memo = (prompt('수정 사유 (선택) — 예: 운송사와 340,000원으로 합의', '') || '').slice(0, 80);
  }
  db.ref(path).set(rec);
}
