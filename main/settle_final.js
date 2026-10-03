/* ============================================================
   정산관리 — ⑤ 완료 확정 (업체 정산 화면 맨 아래)

   흐름: 웹에서 받은 건 '초안' → 대표님이 엑셀에서 직접 확인·수정해 저장 → 그 파일을 여기 올리면 그 달 완료 확정.
     · 확정본은 파일함(settlement/box/{ym})에 거래내역서로 들어가 그 달 공식 완료본이 되고, 다음 달 초안의 틀(표본)이 된다
     · 올릴 때 같은 설정으로 초안을 다시 만들어 확정본과 비교 → 손으로 고친 칸 목록(룰로 옮길 후보)
     · 다시 올리면 마지막 파일이 정본, 이전 확정본은 파일함에 '이전 확정본'으로 남고 이력에 적힌다

   저장: settlement/vendors/{업체키}/done/{ym} = { id, name, orig, at, by, total, nDiff, diff:[[종류,시트,위치,전,후]], hist:{id:{name,orig,at}} }
         settlement/box/{ym}/{id} = { …파일함 형식, type:'statement', final:업체키, orig }   이전 확정본엔 superseded:새id
   쓰는 전역: db, YM, VW, VENDORS, ALLBOX, esc, $, toast, won, ymLabel, ftime, fsize, newId, putBytes, getBytes, WMS2FA, XLSX, makeDraft (settlement.html·settle_*.js)
============================================================ */
var FINAL_BUSY = false, FINAL_MSG = '';

function doneOf(vkey, ym){ return ((((VENDORS[vkey] || {}).done) || {})[ym]) || null; }

/* ── 화면 ── */
var DIFF_KIND = { cell: '칸', chg: '바뀐 줄', add: '추가된 줄', del: '빠진 줄', sheet: '시트' };
function diffHtml(d){
  var L = d.diff || [];
  if (d.nDiff == null) return '<div class="sm dim">초안과 비교하지 못했습니다' + (d.diffErr ? ' (' + esc(d.diffErr) + ')' : '') + '</div>';
  if (!d.nDiff) return '<div class="sm" style="color:var(--g)">초안과 같은 내용입니다 — 손으로 고친 곳 없음</div>';
  return '<div class="sec-note" style="margin:.6rem 0 .3rem">초안과 다른 곳 <b>' + d.nDiff + '</b>곳 — 직접 고치신 내용 (매달 반복되면 대화창에서 룰로 요청)'
    + (d.nDiff > L.length ? ' · 앞 ' + L.length + '곳만 표시' : '') + '</div>'
    + '<div style="overflow-x:auto;max-height:420px;overflow-y:auto"><table class="ftbl" style="min-width:0"><thead><tr><th>구분</th><th>시트</th><th>위치</th><th>초안</th><th>확정본</th></tr></thead><tbody>'
    + L.map(function(x){ return '<tr><td style="white-space:nowrap"><span class="dim">' + esc(DIFF_KIND[x[0]] || x[0]) + '</span></td><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td>'
      + '<td class="dim">' + esc(x[3]) + '</td><td><b>' + esc(x[4]) + '</b></td></tr>'; }).join('')
    + '</tbody></table></div>';
}
function finalCardHtml(){
  var d = doneOf(VW.vkey, YM), lab = esc(ymLabel(YM));
  var head = '<div class="card-h"><span class="card-t">⑤ ' + lab + ' 완료 확정</span><span class="card-s">엑셀에서 확인·수정해 저장한 최종 파일을 올리면 이 달 정산 완료 — 다음 달 초안의 틀이 됩니다</span></div>';
  var zone = '<div class="drop" id="finalDrop" style="margin:.6rem 0 0;padding:1rem" onclick="$(\'finalIn\').click()" ondragover="event.preventDefault();event.stopPropagation()" ondrop="finalDrop(event)">'
    + '<div class="ic">✅</div><b>' + (d ? '수정한 확정 파일 다시 올리기' : '완료된 확정 파일 올리기') + '</b>'
    + '<div class="s">' + esc(VW.name) + ' · ' + lab + ' 최종 거래내역서 (xlsx) — 눌러서 고르거나 여기로 끌어다 놓기</div></div>'
    + '<input type="file" id="finalIn" accept=".xlsx,.xls,.xlsm" class="hide" style="display:none" onchange="if(this.files[0])confirmFinal(this.files[0]);this.value=\'\'">'
    + (FINAL_MSG ? '<div class="sm" style="margin-top:.4rem">' + esc(FINAL_MSG) + '</div>' : '');
  if (!d) return head + '<div class="sm dim" style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">아직 확정 전입니다 (⏳ 작업 중)'
    + ' <button class="btn" style="border-color:#f87171;color:#f87171" onclick="resetFinal()">↺ 처음부터 다시</button></div>' + zone;
  var hist = Object.keys(d.hist || {}).map(function(k){ return d.hist[k]; }).sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  return head
    + '<div class="row" style="border:1px solid var(--g);border-radius:10px;padding:.6rem .8rem"><div class="ck">✅</div><div class="lb"><b>' + esc(d.name) + '</b>'
    + '<small>' + esc(ftime(d.at)) + ' 확정 · ' + esc(d.by || '') + (d.total != null ? ' · 합계 ' + won(d.total) + '원' : '') + (d.orig && d.orig !== d.name ? ' · 올린 파일 ' + esc(d.orig) : '') + '</small></div>'
    + '<div class="ac"><button class="btn" onclick="downFinal()">확정본 내려받기</button> <button class="btn" style="border-color:#f87171;color:#f87171" onclick="resetFinal()">↺ 처음부터 다시</button></div></div>'
    + (d.checksLeft == null ? '' : d.checksLeft ? '<div class="sm" style="color:#fbbf24;margin-top:.4rem">⚠️ 확정 때 남아 있던 노란 칸(점검 표시) ' + d.checksLeft + '곳: ' + esc((d.checksList || []).slice(0, 20).join(', ')) + (d.checksLeft > 20 ? ' …' : '') + '</div>' : '<div class="sm" style="color:var(--g);margin-top:.4rem">✔ 점검 표시(노란 칸) 모두 확인됨</div>')
    + diffHtml(d)
    + (hist.length ? '<div class="sm dim" style="margin-top:.5rem">이전 확정 ' + hist.length + '번: ' + hist.map(function(h){ return esc(ftime(h.at)) + ' ' + esc(h.orig || h.name); }).join(' · ') + ' (파일함에 「이전 확정본」으로 남아 있음)</div>' : '')
    + zone;
}
function finalDrop(e){
  e.preventDefault(); e.stopPropagation();   /* 파일함 올리기(문서 전체 끌어다 놓기)로 가지 않게 */
  var dr = $('drop'); if (dr) dr.classList.remove('over');
  var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) confirmFinal(f);
}
/* ↺ 처음부터 다시: 이 달 이 업체 완료 확정을 취소하고 깨끗한 상태로 (룰이 바뀌었을 때 지금 룰로 다시 만들어 다시 확정)
   · done/{ym} 지움 → ⏳ 작업 중으로, 다음 달 표본에서도 빠짐
   · 확정 파일은 지우지 않고 파일함에 「이전 확정본」(superseded:'reset')으로 남김 + resets/{ym} 에 이력
   · 이번 달 화면 입력값(run/{ym}: 수동 수량·원본 선택)도 지움 */
function resetFinal(){
  var d = doneOf(VW.vkey, YM); if (FINAL_BUSY) return;
  if (!d){   /* 확정 전: 이번 달 화면 입력값(수동 수량·원본 선택)만 지우고 결과 목록 비움 — 초안은 언제나 지금 원본·룰로 새로 만들어짐 */
    if (!confirm(ymLabel(YM) + ' ' + VW.name + ' 정산을 처음부터 다시 할까요?\n\n· 아직 확정 전이라 지울 확정 파일은 없습니다\n· 이 달 화면에 넣은 입력값(수량·원본 선택)과 방금 만든 결과 목록을 지웁니다\n\n그다음 「초안 내려받기」를 누르면 지금 파일함 원본과 지금 룰로 처음부터 새로 만듭니다.')) return;
    db.ref('settlement/vendors/' + VW.vkey + '/run/' + YM).set(null).then(function(){
      VW._lastLog = null; var bl = $('buildLog'); if (bl) bl.innerHTML = ''; var bm = $('buildMsg'); if (bm) bm.textContent = '';
      var V2 = VENDORS[VW.vkey]; if (V2 && V2.run) delete V2.run[YM];
      toast('↺ ' + ymLabel(YM) + ' ' + VW.name + ' — 원점으로 돌아갔습니다'); finalMsg('원점으로 돌아갔습니다 — 위 ④ 에서 초안을 다시 받으면 처음부터 계산합니다');
      refreshRunState(true);
    }).catch(function(e){ alert('실패: ' + ((e && (e.code || e.message)) || e)); });
    return;
  }
  if (!confirm(ymLabel(YM) + ' ' + VW.name + ' 정산을 처음부터 다시 할까요?\n\n· 완료 확정이 취소되고 「작업 중」으로 돌아갑니다\n· 확정했던 파일(' + (d.orig || d.name) + ')은 지우지 않고 파일함에 「이전 확정본」으로 남습니다\n· 이 달 화면에 넣은 입력값(수량·원본 선택)도 지웁니다\n\n그다음 초안을 다시 받아 → 엑셀 확인 → 다시 확정하면 됩니다.')) return;
  var u = {}, by = (me && me.email) || '';
  u['vendors/' + VW.vkey + '/done/' + YM] = null;
  u['vendors/' + VW.vkey + '/run/' + YM] = null;
  u['vendors/' + VW.vkey + '/resets/' + YM + '/' + newId()] = { id: d.id, name: d.name, orig: d.orig || '', total: d.total == null ? null : d.total, at: firebase.database.ServerValue.TIMESTAMP, by: by };
  if ((ALLBOX[YM] || {})[d.id]) u['box/' + YM + '/' + d.id + '/superseded'] = 'reset';
  db.ref('settlement').update(u).then(function(){ var V2 = VENDORS[VW.vkey]; if (V2){ if (V2.run) delete V2.run[YM]; if (V2.done) delete V2.done[YM]; } VW._lastLog = null; var bl = $('buildLog'); if (bl) bl.innerHTML = '';
    toast('↺ ' + ymLabel(YM) + ' ' + VW.name + ' — 확정 취소, 원점으로'); finalMsg('확정을 취소하고 원점으로 돌아갔습니다 — 위 ④ 에서 초안을 다시 받아 주세요'); refreshRunState(true); })
    .catch(function(e){ alert('실패: ' + ((e && (e.code || e.message)) || e)); });
}
function finalMsg(t){ FINAL_MSG = t; var c = $('finalCard'); if (c) c.innerHTML = finalCardHtml(); }
function downFinal(){
  var d = doneOf(VW.vkey, YM), m = d && ((ALLBOX[YM] || {})[d.id]); if (!m){ toast('확정 파일을 파일함에서 찾지 못했습니다'); return; }
  toast('내려받는 중…');
  getBytes(m.path).then(function(ab){ return WMS2FA.decrypt(m.path, m.iv, ab); }).then(function(bytes){
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = m.name;
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }).catch(function(e){ alert('내려받기 실패: ' + ((e && (e.code || e.message)) || e)); });
}

/* ── 초안 ↔ 확정본 비교 (SheetJS 통합문서 둘) ── */
function dcell(c){
  if (!c) return { k: '', t: '' };
  var v = c.v, t;
  if (typeof v === 'number') v = Math.round(v * 100) / 100;
  if (typeof v === 'string') v = v.replace(/\s+/g, ' ').trim();
  t = c.w != null && c.w !== '' ? String(c.w).trim() : (v == null ? '' : String(v));
  if (c.f) return { k: 'f:' + String(c.f).replace(/\s+/g, '').replace(/^=/, '').toUpperCase(), v: v, t: '=' + c.f + (v != null && v !== '' ? ' (' + t + ')' : '') };
  return { k: v == null ? '' : 'v:' + v, v: v, t: t };
}
function sameCell(a, b){
  if (a.k === b.k) return true;
  /* 한쪽만 수식이면 값으로 비교 (초안 수식은 계산값이 없을 수 있음) */
  var av = a.k.indexOf('f:') === 0 ? a.v : (a.k ? a.v : ''), bv = b.k.indexOf('f:') === 0 ? b.v : (b.k ? b.v : '');
  if (a.k.indexOf('f:') === 0 && b.k.indexOf('f:') === 0) return false;
  if ((a.k.indexOf('f:') === 0 && a.v == null) || (b.k.indexOf('f:') === 0 && b.v == null)) return false;
  return String(av == null ? '' : av) === String(bv == null ? '' : bv);
}
function sheetRows(ws){
  if (!ws || !ws['!ref']) return [];
  var R = XLSX.utils.decode_range(ws['!ref']), out = [];
  for (var r = R.s.r; r <= R.e.r; r++){
    var row = [], any = false;
    for (var c = R.s.c; c <= R.e.c; c++){ var x = dcell(ws[XLSX.utils.encode_cell({ r: r, c: c })]); row.push(x); if (x.k) any = true; }
    while (row.length && !row[row.length - 1].k) row.pop();
    out.push(any ? row : null);
  }
  return out;
}
function rowSig(row){ return row.map(function(x){ return x.k.indexOf('f:') === 0 && x.v != null ? 'v:' + x.v : x.k; }).join('\u0001'); }
function rowText(row){ return row.filter(function(x){ return x.k; }).map(function(x){ return x.t; }).join(' | ').slice(0, 160); }
function diffBooks(dw, fw, stmtName){
  var out = [], n = 0, CAP = 300;
  var push = function(e){ n++; if (out.length < CAP) out.push(e); };
  var fNames = fw.SheetNames, dNames = dw.SheetNames;
  dNames.forEach(function(s){ if (fNames.indexOf(s) < 0) push(['sheet', s, '', '있음', '확정본에 없음']); });
  fNames.forEach(function(s){ if (dNames.indexOf(s) < 0) push(['sheet', s, '', '없음', '확정본에 새로 있음']); });
  var stmt = fNames.indexOf(stmtName) >= 0 ? stmtName : fNames[0];
  fNames.forEach(function(s){
    if (dNames.indexOf(s) < 0) return;
    var a = dw.Sheets[s], b = fw.Sheets[s];
    if (s === stmt){
      /* 거래명세표 — 칸 단위 */
      var seen = {};
      [a, b].forEach(function(ws){ Object.keys(ws || {}).forEach(function(k){ if (k[0] !== '!') seen[k] = 1; }); });
      Object.keys(seen).sort(function(x, y){ var X = XLSX.utils.decode_cell(x), Y = XLSX.utils.decode_cell(y); return X.r - Y.r || X.c - Y.c; }).forEach(function(k){
        var x = dcell(a[k]), y = dcell(b[k]); if (!sameCell(x, y)) push(['cell', s, k, x.t, y.t]);
      });
      return;
    }
    /* 데이터 시트 — 줄 단위: 같은 줄은 지우고, 앞 4칸이 같은 줄끼리는 '바뀐 줄', 나머지는 추가/빠짐 */
    var A = sheetRows(a), B = sheetRows(b), pool = {}, head = null;
    for (var i = 0; i < Math.min(B.length, 12); i++){ if (B[i] && (!head || B[i].filter(function(x){ return typeof x.v === 'string'; }).length > head.filter(function(x){ return typeof x.v === 'string'; }).length)) head = B[i]; }
    A.forEach(function(r, i){ if (r){ var g = rowSig(r); (pool[g] = pool[g] || []).push(i); } });
    var added = [];
    B.forEach(function(r, i){ if (!r) return; var g = rowSig(r); if (pool[g] && pool[g].length) pool[g].shift(); else added.push(i); });
    var removed = []; Object.keys(pool).forEach(function(g){ pool[g].forEach(function(i){ removed.push(i); }); });
    var key4 = function(r){ return r.slice(0, 4).map(function(x){ return x.k; }).join('\u0001'); };
    var rmBy = {}; removed.forEach(function(i){ var k = key4(A[i]); (rmBy[k] = rmBy[k] || []).push(i); });
    added.sort(function(x, y){ return x - y; }).forEach(function(i){
      var r = B[i], k = key4(r), j = rmBy[k] && rmBy[k].length ? rmBy[k].shift() : null;
      if (j == null){ push(['add', s, (i + 1) + '행', '', rowText(r)]); return; }
      var cols = [], o = A[j];
      for (var c = 0; c < Math.max(r.length, o.length); c++){
        var x = o[c] || { k: '', t: '' }, y = r[c] || { k: '', t: '' };
        if (!sameCell(x, y)) cols.push([(head && head[c] && head[c].t) || XLSX.utils.encode_col(c), x.t, y.t]);
      }
      if (!cols.length) return;
      push(['chg', s, (i + 1) + '행 · ' + rowText(r.slice(0, 4)), cols.map(function(z){ return z[0] + ' ' + z[1]; }).join(', '), cols.map(function(z){ return z[0] + ' ' + z[2]; }).join(', ')]);
    });
    Object.keys(rmBy).forEach(function(k){ rmBy[k].forEach(function(j){ push(['del', s, '초안 ' + (j + 1) + '행', rowText(A[j]), '']); }); });
  });
  return { n: n, list: out };
}

/* ── 올리기 = 완료 확정 ── */
/* 남은 점검 색(노란 FFF2B3) 찾기 — 초안에서 확인할 칸은 모두 이 색, 대표님이 확인하면 색을 지움 (2026-10-03) */
var CHECK_ARGB = 'FFFFF2B3';
function leftChecks(buf){
  var wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buf).then(function(){
    var L = [], sheetLeft = false;
    wb.eachSheet(function(ws){
      if (/^점검/.test(ws.name)){ sheetLeft = true; return; }
      ws.eachRow({ includeEmpty: false }, function(row){ row.eachCell({ includeEmpty: true }, function(c){
        var f = c.fill; if (f && f.type === 'pattern' && f.pattern === 'solid' && f.fgColor && String(f.fgColor.argb).toUpperCase() === CHECK_ARGB) L.push(ws.name + '!' + c.address); }); });
    });
    return { list: L, sheet: sheetLeft };
  });
}
function confirmFinal(file){
  if (FINAL_BUSY || !VW) return;
  if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)){ alert('엑셀 파일(xlsx)을 올려 주세요'); return; }
  /* 옛 xls 확정본은 다음 달 초안의 틀이 될 때 서식(테두리·글꼴·도장)이 빠짐 → xlsx 로 저장해 올리게 */
  if (/\.xls$/i.test(file.name) && !confirm('옛 xls 형식입니다.\n\n이 파일이 다음 달 초안의 틀이 되는데, xls 는 웹에서 테두리·글꼴·도장 같은 서식이 빠집니다.\n엑셀에서 「다른 이름으로 저장 → Excel 통합 문서(xlsx)」로 저장해 올리시는 게 좋습니다.\n\n그래도 xls 로 확정할까요?')) return;
  var named = /^\d{1,2}월_거래내역서_/.test(file.name) ? SETTLE_STMT.vendorFromFile(file.name) : null;
  if (named && named.replace(/\s+/g, '') !== VW.name.replace(/\s+/g, '') && !confirm('파일 이름의 업체가 「' + named + '」 입니다.\n지금 화면은 「' + VW.name + '」 입니다.\n\n그래도 ' + VW.name + ' 확정본으로 올릴까요?')) return;
  var prev = doneOf(VW.vkey, YM);
  if (prev && !confirm('이미 확정된 파일이 있습니다.\n\n기존: ' + (prev.orig || prev.name) + ' (' + ftime(prev.at) + ')\n새 파일: ' + file.name + '\n\n새 파일을 정본으로 할까요? (기존 파일은 이력으로 남습니다)')) return;
  FINAL_BUSY = true;
  var V = VW, ym = YM, vkey = V.vkey, buf, fwb, left = null, total = null, diff = null, diffErr = '', id = newId(), path = 'settlement/' + ym + '/' + id;
  var ext = (file.name.split('.').pop() || 'xlsx').toLowerCase(), name = ym.slice(5, 7) + '월_거래내역서_' + V.name + '.' + ext;
  finalMsg('확정 파일 읽는 중…');
  file.arrayBuffer().then(function(b){
    buf = b; fwb = XLSX.read(b, { type: 'array', cellFormula: true });
    finalMsg('남은 점검(노란 칸) 찾는 중…');
    return leftChecks(b).then(function(lc){ left = lc;
      if (lc.list.length || lc.sheet){
        var t = (lc.list.length ? '아직 노란색(점검 표시)이 남은 칸 ' + lc.list.length + '곳:\n' + lc.list.slice(0, 15).join(', ') + (lc.list.length > 15 ? ' …' : '') + '\n\n' : '') + (lc.sheet ? '점검 시트가 아직 남아 있습니다.\n\n' : '');
        if (!confirm(t + '그래도 이 파일로 확정할까요? (취소하면 엑셀에서 마저 확인)')) throw { cancel: true };
      }
    }).catch(function(x){ if (x && x.cancel) throw x; left = null; });
  }).then(function(){
    try { var A2 = SETTLE_STMT.analyze(fwb); total = A2 && A2.totals ? (A2.totals.total != null ? A2.totals.total : null) : null; } catch (e) {}
    finalMsg('같은 설정으로 초안을 다시 만들어 비교하는 중…');
    return makeDraft(function(){}).then(function(D){ return D.wb.xlsx.writeBuffer(); }).then(function(db2){
      diff = diffBooks(XLSX.read(db2, { type: 'array', cellFormula: true }), fwb, V.A && V.A.sheet);
    }).catch(function(e){ diffErr = (e && (e.code || e.message)) || String(e); console.error(e); });
  }).then(function(){
    finalMsg('암호화해서 올리는 중…');
    return WMS2FA.encrypt(path, buf);
  }).then(function(enc){
    return putBytes(path, enc.data, function(p){ finalMsg('올리는 중 ' + Math.round(p * 100) + '%'); }).then(function(){ return enc.iv; });
  }).then(function(iv){
    var now = firebase.database.ServerValue.TIMESTAMP, by = (me && me.email) || '';
    var meta = { name: name, orig: file.name, size: file.size, ext: ext, type: 'statement', final: vkey,
      summary: '✅ 완료 확정' + (total != null ? ' · 합계 ' + won(total) + '원' : ''),
      sheets: fwb.SheetNames.map(function(n){ var ws = fwb.Sheets[n], r = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e.r : 0; return { n: n, r: r }; }).slice(0, 40),
      sheetKey: fwb.SheetNames.slice().sort().join('|'), headKey: '', iv: iv, path: path, at: now, by: by };
    var hist = (prev && prev.hist) || {};
    if (prev && prev.id) hist[prev.id] = { name: prev.name, orig: prev.orig || '', at: prev.at || 0 };
    var rec = { id: id, name: name, orig: file.name, at: now, by: by, total: total,
      checksLeft: left ? left.list.length : null, checksList: left && left.list.length ? left.list.slice(0, 200) : null,
      nDiff: diff ? diff.n : null, diff: diff ? diff.list : null, diffErr: diffErr || null, hist: Object.keys(hist).length ? hist : null };
    var u = {};
    u['box/' + ym + '/' + id] = meta;
    u['vendors/' + vkey + '/done/' + ym] = rec;
    if (prev && prev.id && (ALLBOX[ym] || {})[prev.id]) u['box/' + ym + '/' + prev.id + '/superseded'] = id;
    return db.ref('settlement').update(u);
  }).then(function(){
    FINAL_BUSY = false;
    toast('✅ ' + ymLabel(ym) + ' ' + V.name + ' 완료 확정');
    finalMsg(diff ? '확정했습니다 — 초안과 다른 곳 ' + diff.n + '곳' : '확정했습니다' + (diffErr ? ' (초안 비교 실패: ' + diffErr + ')' : ''));
  }).catch(function(e){
    FINAL_BUSY = false; if (e && e.cancel){ finalMsg('확정을 취소했습니다 — 엑셀에서 노란 칸을 마저 확인해 주세요'); return; } finalMsg('실패: ' + ((e && (e.code || e.message)) || e)); console.error(e);
  });
}
