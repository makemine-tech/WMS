/* ============================================================
   정산관리 — 🗂️ 삼자물류정산관리 (대표님 2026-10-05 · 00_삼자물류정산관리_MM월.xlsx 를 웹으로)
   달마다 업체 한 줄: 관리업체 · 업체명 · 정산서전달메일 · 전미수 · 정산금액 · 송금·토스(보낼 돈) · 입금액
                      · 1.정산서전달 · 2.계산서발행 · 3.체크완료 · 4.업체송금(입금) · 미수 · 메모
     + 거래내역서 내려받기: 원본 양식 / 디자인 1·2·3 (settle_design.js)
     + 업체 정보(세금계산서용) — 한 번 넣으면 다음 달에도 · 기타 거래처 줄
     + 관리표 엑셀 가져오기(시트 「YY_MM월정산분」 전부 또는 보는 달만) · 내보내기(원래 관리표 열 그대로)
   달 = 이 탭 위 달 고르기(파일함 정산월과 따로) — 지난달(8월·7월…)도 넣을 수 있음
   정산금액 = ① ✅ 완료 확정본 합계 ② 그 달 파일함에 있는 그 업체 거래내역서 합계(지난 정산서) ③ 직접 넣은 값(관리표 가져오기 포함)
   DB: settlement/ledger/{ym}/{업체키} = { sent, inv, chk, paid, paidAmt(입금액), send(송금·토스 = 보낼 돈), carry, amount(직접), memo }
       settlement/ledgerInfo/{업체키} = { group, mail, biz, corp, ceo, addr, btype, bitem, mail1, mail2 }
       settlement/ledgerExtra/{ym}/{id} = { group, name, mail, amount, send, sent, inv, chk, paid, paidAmt, carry, memo }
       settlement/ledgerAlias/{관리표 이름} = 업체키   — 관리표 이름(법인명) ↔ 정산서 업체 연결을 기억 (금액으로 한 번 맞추면 지난달 시트에도)
   전미수 = 지난달 미수 (지난달 전미수 + 정산금액 − 입금액, 「입금」만 체크하고 입금액이 비면 전액 입금) — 직접 넣으면(carry) 그 값
   쓰는 전역: db, YM, ALLBOX, VENDORS, monthVendors, doneOf, decryptBox, esc, toast, ymLabel, firebase, XLSX, SETTLE_DESIGN, SETTLE_STMT
============================================================ */
var LEDGER = {}, LINFO = {}, LEXTRA = {}, LALIAS = {}, LYM = null, LG_OPT = (function(){ try { return JSON.parse(localStorage.getItem('ledgerOpt')) || { design: 'd1', hideZero: true }; } catch (e) { return { design: 'd1', hideZero: true }; } })();
function lgYM(){ return LYM || YM; }
function ledgerListen(){
  var re = function(){ if ($('tabLedger') && !$('tabLedger').classList.contains('hide') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tabLedger input[type=text], #tabLedger input[type=number], #tabLedger textarea'))) renderLedger(); };
  db.ref('settlement/ledger').on('value', function(s){ LEDGER = s.val() || {}; re(); });
  db.ref('settlement/ledgerInfo').on('value', function(s){ LINFO = s.val() || {}; re(); });
  db.ref('settlement/ledgerExtra').on('value', function(s){ LEXTRA = s.val() || {}; re(); });
  db.ref('settlement/ledgerAlias').on('value', function(s){ LALIAS = s.val() || {}; });
}
function lgSetYM(ym){ if (!/^\d{4}-\d{2}$/.test(ym || '')) return; LYM = ym; renderLedger(); }
function lgPrev(ym){ var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (!m){ m = 12; y--; } return y + '-' + String(m).padStart(2, '0'); }
/* 그 달 파일함의 이 업체 거래내역서(완료 확정본 먼저, 없으면 지난 정산서 표본) */
function lgStmt(name, ym){
  var B = (ALLBOX || {})[ym] || {}, best = null;
  Object.keys(B).forEach(function(id){ var m = B[id]; if (!m || m.type !== 'statement' || m.superseded) return; if (SETTLE_STMT.vendorFromFile(m.name) !== name) return;
    if (!best || (m.final && !best.m.final)) best = { id: id, m: m }; });
  return best;
}
/* 정산금액 = 확정본 합계 → 그 달 거래내역서 합계(표본 분석값) → 직접 */
function lgAuto(vk, name, ym){
  var d = doneOf(vk, ym); if (d && +d.total) return { v: +d.total, src: '확정본' };
  if (d && d.id) return { v: null, src: '', reread: true };   /* 확정했는데 합계가 0·없음 → 「합계 다시 읽기」 */
  var st = (VENDORS[vk] || {}).stat, S = lgStmt(name, ym);
  if (st && st.total != null && S && st.sid && String(st.sid).indexOf(S.id) >= 0) return { v: +st.total, src: '거래내역서' };
  return null;
}
function lgState(kind, key, ym, depth, name){
  var rec = kind === 'v' ? ((LEDGER[ym] || {})[key] || {}) : ((LEXTRA[ym] || {})[key] || {});
  var A = kind === 'v' ? lgAuto(key, name || key, ym) : null, man = rec.amount != null && rec.amount !== '' ? +rec.amount : null;
  var reread = !!(A && A.reread); if (reread) A = null;
  var amt = A ? A.v : man, src = A ? A.src : (man != null ? '직접' : '');
  var carry = rec.carry != null && rec.carry !== '' ? +rec.carry : (depth > 24 || kind !== 'v' ? 0 : lgState('v', key, lgPrev(ym), (depth || 0) + 1, name).unpaid);
  var due = (carry || 0) + (amt || 0);
  var paid = rec.paidAmt != null && rec.paidAmt !== '' ? +rec.paidAmt : (rec.paid ? due : 0);
  return { rec: rec, amt: amt, src: src, man: man, reread: reread, carry: carry || 0, paid: paid, unpaid: Math.round(due - paid) };
}
function lgSet(path, v){ return db.ref('settlement/' + path).set(v === '' || v == null || v === false ? null : v).catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); }); }
function lgOpt(k, v){ LG_OPT[k] = v; try { localStorage.setItem('ledgerOpt', JSON.stringify(LG_OPT)); } catch (e) {} }
var won0 = function(n){ return n == null || n === '' ? '' : Math.round(+n).toLocaleString('ko-KR'); };

function lgMonthBar(ym){
  var now = new Date(Date.now() + 9 * 3600e3), y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, chips = [];
  for (var i = 0; i < 14; i++){ var k = y + '-' + String(m).padStart(2, '0'); chips.push(k); m--; if (!m){ m = 12; y--; } }
  Object.keys(LEDGER).concat(Object.keys(LEXTRA)).forEach(function(k){ if (chips.indexOf(k) < 0) chips.push(k); });
  chips.sort().reverse();
  var has = function(k){ return !!(LEDGER[k] && Object.keys(LEDGER[k]).length) || !!(LEXTRA[k] && Object.keys(LEXTRA[k]).length); };
  return '<div class="lg-months"><span class="sm dim" style="white-space:nowrap">• 기록 있는 달</span>'
    + chips.map(function(k){ var on = k === ym; return '<button class="btn' + (on ? ' p' : '') + '" style="padding:.15rem .5rem;font-size:11.5px;white-space:nowrap' + (has(k) || on ? '' : ';opacity:.5') + '" onclick="lgSetYM(\'' + k + '\')">' + (+k.slice(2, 4)) + '.' + k.slice(5, 7) + (has(k) ? '•' : '') + '</button>'; }).join('')
    + '<input type="month" value="' + ym + '" style="font-size:12px;padding:.1rem .3rem" onchange="lgSetYM(this.value)"></div>';
}
/* 진행 단계 = 1 전달완료 · 2 계산서발행완료 · 3 체크완료 (예전 sent·inv·chk 칸과 같은 값) — 입금은 입금액으로만 */
function lgStage(rec){ return rec.chk ? 3 : rec.inv ? 2 : rec.sent ? 1 : 0; }
function lgSetStage(base, n){ n = +n; var u = {}; u[base + '/sent'] = n >= 1 || null; u[base + '/inv'] = n >= 2 || null; u[base + '/chk'] = n >= 3 || null; return db.ref('settlement').update(u); }
function lgBulk(n){
  var ym = lgYM(), L = window._lgRows || [], u = {}, c = 0;
  L.forEach(function(r){ if (r.skip || !(r.s.amt || r.s.carry)) return; if (lgStage(r.s.rec) >= n) return; var base = (r.kind === 'v' ? 'ledger/' : 'ledgerExtra/') + ym + '/' + r.key;
    u[base + '/sent'] = true; if (n >= 2) u[base + '/inv'] = true; c++; });
  if (!c){ toast('바꿀 업체가 없습니다'); return; }
  if (!confirm(ymLabel(ym) + ' 정산금액이 있는 업체 ' + c + '곳을 「' + (n >= 2 ? '2 계산서발행완료' : '1 전달완료') + '」로 바꿀까요?')) return;
  db.ref('settlement').update(u).then(function(){ toast('✔ ' + c + '곳 바꿈'); });
}
/* 화면 고정: 이 탭에서는 페이지가 안 움직이고 목록 안에서만 위아래·좌우 스크롤 */
function lgFit(){
  var w = document.getElementById('lgScroll'); if (!w || $('tabLedger').classList.contains('hide')) return;
  var top = w.getBoundingClientRect().top; w.style.maxHeight = Math.max(220, window.innerHeight - top - 14) + 'px';
}
window.addEventListener('resize', lgFit);

function renderLedger(){
  var el = $('tabLedger'); if (!el) return;
  var ym = lgYM(); if (!ym){ el.innerHTML = ''; return; }
  var V = monthVendors(ym), X = LEXTRA[ym] || {};
  var rows = V.map(function(v){ var s = lgState('v', v.vk, ym, 0, v.name), I = LINFO[v.vk] || {}; return { kind: 'v', key: v.vk, name: v.name, skip: v.skip, I: I, s: s, group: I.group || '', file: lgFinal(v.vk, v.name, ym) }; })
    .concat(Object.keys(X).map(function(id){ var s = lgState('x', id, ym, 0); return { kind: 'x', key: id, name: X[id].name || '(이름 없음)', I: X[id], s: s, group: X[id].group || '' }; }));
  rows.sort(function(a, b){ return (a.kind === b.kind ? 0 : a.kind === 'v' ? -1 : 1) || String(a.group).localeCompare(String(b.group), 'ko') || a.name.localeCompare(b.name, 'ko'); });
  window._lgRows = rows;
  var act = rows.filter(function(r){ return !r.skip && (r.s.amt || r.s.carry || r.s.rec.send); });
  var S = { amt: 0, paid: 0, unpaid: 0, send: 0, n: act.length, st: [0, 0, 0, 0], pd: 0 };
  act.forEach(function(r){ S.amt += r.s.amt || 0; S.paid += r.s.paid || 0; S.send += +r.s.rec.send || 0; S.unpaid += r.s.unpaid > 0 ? r.s.unpaid : 0; for (var k = 1; k <= lgStage(r.s.rec); k++) S.st[k]++; if ((r.s.amt || r.s.carry) && r.s.unpaid <= 0) S.pd++; });
  var card = function(t, v, s, c){ return '<div class="lg-card"><span class="lg-ct">' + t + '</span><b' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b>' + (s ? '<span class="lg-cs">' + s + '</span>' : '') + '</div>'; };
  var dsel = '<select class="tsel" style="font-size:12px" onchange="lgOpt(\'design\', this.value)">' + [{ id: 'orig', name: '원본 양식' }].concat(SETTLE_DESIGN.list).map(function(d){ return '<option value="' + d.id + '"' + (LG_OPT.design === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>';
  var h = '<style>'
    + '.lg-top{display:flex;align-items:center;gap:.5rem;flex-wrap:nowrap;margin:0 0 .45rem}.lg-top .bar-t{white-space:nowrap}'
    + '.lg-months{display:flex;gap:.3rem;align-items:center;overflow-x:auto;flex:1;min-width:0;padding:.1rem 0;scrollbar-width:thin}'
    + '.lg-cards{display:flex;gap:.45rem;margin:0 0 .5rem}.lg-card{flex:1;min-width:0;background:var(--s2);border:1px solid var(--br);border-radius:9px;padding:.3rem .6rem;display:flex;flex-direction:column;line-height:1.25}'
    + '.lg-ct{font-size:10.5px;color:var(--mu);white-space:nowrap}.lg-card b{font-size:14px;white-space:nowrap}.lg-cs{font-size:10px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '#lgScroll{overflow:auto;border:1px solid var(--br);border-radius:10px}'
    + '.lgt{min-width:1180px;margin:0}.lgt thead th{position:sticky;top:0;z-index:2;background:var(--s1)}'
    + '.lgt .stk{position:sticky;left:0;z-index:1;background:var(--s1);box-shadow:1px 0 0 var(--br)}.lgt thead th.stk{z-index:3}'
    + '.lgt td{padding:.3rem .4rem}.lgt input.famt{padding:.15rem .35rem}'
    + '</style>'
    + '<div class="lg-top"><span class="bar-t">' + esc(ymLabel(ym)) + ' 삼자물류정산관리</span>' + lgMonthBar(ym)
    + '<label class="btn" style="cursor:pointer;white-space:nowrap;font-size:12px">📥 관리표 가져오기<input type="file" accept=".xlsx,.xls" style="display:none" onchange="lgImport(this)"></label>'
    + '<button class="btn" style="white-space:nowrap;font-size:12px" onclick="lgExport()">📤 내보내기</button><button class="btn" style="white-space:nowrap;font-size:12px" onclick="lgAddExtra()">＋ 기타 거래처</button></div>'
    + '<div class="lg-cards">'
    + card('정산 업체', S.n + '곳', '금액 있는 곳') + card('청구 합계 (VAT 포함)', '₩' + won0(S.amt), '공급가 ₩' + won0(S.amt / 1.1))
    + card('송금·토스 (보낼 돈)', '₩' + won0(S.send), '관리표 송금토스') + card('입금 완료', '₩' + won0(S.paid), S.pd + ' / ' + S.n + '곳', 'var(--g)') + card('미수 합계', '₩' + won0(S.unpaid), '전미수 포함', S.unpaid ? '#f87171' : 'var(--g)')
    + card('진행', '전달 ' + S.st[1] + ' · 계산서 ' + S.st[2], '체크 ' + S.st[3] + ' / ' + S.n) + '</div>'
    + '<div style="display:flex;gap:.45rem;align-items:center;margin:0 0 .4rem;flex-wrap:wrap"><button class="btn" style="font-size:12px" onclick="lgBulk(1)">✉️ 일괄 전달완료</button><button class="btn" style="font-size:12px" onclick="lgBulk(2)">🧾 일괄 계산서발행완료</button>'
    + '<span class="sp" style="flex:1"></span><span class="sm dim">내려받기 모양</span> ' + dsel + ' <label class="sm"><input type="checkbox" ' + (LG_OPT.hideZero ? 'checked' : '') + ' onchange="lgOpt(\'hideZero\', this.checked)"> 0원 줄 숨기기</label></div>'
    + '<div id="lgScroll"><table class="ftbl lgt"><thead><tr><th class="stk">업체명</th><th>관리업체</th><th class="n">전미수</th><th class="n">정산금액</th><th class="n">송금·토스</th><th class="n">입금액</th>'
    + '<th>진행</th><th class="n">미수</th><th>거래내역서</th><th>메모</th><th></th></tr></thead><tbody>';
  var P = function(r, k){ return (r.kind === 'v' ? 'ledger/' + ym + '/' + r.key : 'ledgerExtra/' + ym + '/' + r.key) + (k ? '/' + k : ''); };
  rows.forEach(function(r){
    var s = r.s, rec = s.rec, I = r.I || {}, stg = lgStage(rec);
    var num = function(k, v, ph, red){ return '<input type="number" class="famt" style="width:105px' + (red ? ';color:#f87171;font-weight:700' : '') + '" value="' + (v != null && v !== '' ? v : '') + '" placeholder="' + (ph || '') + '" onchange="lgSet(\'' + P(r, k) + '\', this.value === \'\' ? null : +this.value)">'; };
    var dl = r.file ? '<button class="btn p" style="padding:.1rem .5rem;font-size:12px" onclick="lgDownload(\'' + esc(r.key) + '\')" title="' + esc(r.file.m.name) + '">📄 ' + (r.file.m.final ? '확정본' : '거래내역서') + '</button>' : r.kind === 'v' ? '<span class="sm dim">' + (r.skip ? '이번 달 없음' : '파일 없음') + '</span>' : '';
    var rr = s.reread ? '<div><button class="btn" style="padding:.05rem .45rem;font-size:11px;color:#fbbf24" onclick="lgReread(\'' + esc(r.key) + '\')" title="완료 확정 때 합계를 못 읽어 0 으로 저장됨 — 확정본 파일에서 다시 읽기">↻ 확정본 합계 다시 읽기</button></div>' : '';
    var amtCell = rr + (r.kind === 'v' && s.src && s.src !== '직접' ? '<b>' + won0(s.amt) + '</b><div class="sm dim">' + s.src + (s.man != null && Math.abs(s.man - s.amt) > 1 ? ' · <span style="color:#fbbf24">관리표 ' + won0(s.man) + '</span>' : '') + '</div>' : num('amount', rec.amount, '정산금액'));
    var sel = '<select class="tsel" style="font-size:12px;padding:.1rem .3rem' + (stg ? ';color:var(--g)' : '') + '" onchange="lgSetStage(\'' + P(r) + '\', this.value)">' + ['대기', '1 전달완료', '2 계산서발행완료', '3 체크완료'].map(function(t, k){ return '<option value="' + k + '"' + (k === stg ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>';
    var carryRed = s.carry > 0;
    h += '<tr' + (r.skip ? ' style="opacity:.45"' : '') + '>'
      + '<td class="stk" style="min-width:200px;max-width:240px"><b>' + esc(r.name) + '</b>' + (r.kind === 'v' ? ' <a href="javascript:void 0" class="sm" title="정산서 전달메일 · 세금계산서용 정보" onclick="lgInfo(\'' + esc(r.key) + '\')">⚙' + (I.biz && I.mail ? '' : '<span style="color:#fbbf24">!</span>') + '</a>' : '') + (rec.xlName && rec.xlName !== r.name ? '<div class="sm dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">관리표: ' + esc(rec.xlName) + '</div>' : '') + '</td>'
      + '<td><input type="text" class="famt" style="width:80px" value="' + esc(r.group) + '" onchange="lgSet(\'' + (r.kind === 'v' ? 'ledgerInfo/' + r.key + '/group' : P(r, 'group')) + '\', this.value.trim())"></td>'
      + '<td class="n">' + num('carry', rec.carry, s.carry ? won0(s.carry) : '', carryRed) + (carryRed && (rec.carry == null || rec.carry === '') ? '<div class="sm" style="color:#f87171">미수 ' + won0(s.carry) + '</div>' : '') + '</td>'
      + '<td class="n">' + amtCell + '</td><td class="n">' + num('send', rec.send, '보낼 돈') + '</td><td class="n">' + num('paidAmt', rec.paidAmt, rec.paid && rec.paidAmt == null ? '관리표 입금' : '입금액') + '</td>'
      + '<td>' + sel + '</td>'
      + '<td class="n"><b style="color:' + (s.unpaid > 0 ? '#f87171' : s.unpaid < 0 ? '#60a5fa' : 'var(--g)') + '">' + (s.unpaid ? won0(s.unpaid) + (s.unpaid < 0 ? ' (초과)' : '') : (s.amt || s.carry ? '완료' : '')) + '</b></td>'
      + '<td>' + dl + '</td><td><input type="text" class="famt" style="width:150px" value="' + esc(rec.memo || '') + '" onchange="lgSet(\'' + P(r, 'memo') + '\', this.value.trim())"></td>'
      + '<td>' + (r.kind === 'x' ? '<button class="btn r" style="padding:.05rem .4rem" onclick="lgDelExtra(\'' + r.key + '\')">×</button>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
  setTimeout(lgFit, 0);
}
function lgFinal(vk, name, ym){
  ym = ym || lgYM(); var d = doneOf(vk, ym);
  if (d && d.id){ var m = ((ALLBOX || {})[ym] || {})[d.id]; if (m) return { m: m, d: d }; }
  return lgStmt(name || vk, ym);
}
/* 확정본 합계 다시 읽기 — 완료 확정 때 합계를 0 으로 읽은 기록(2026-10-05 스타 온라인세일즈: 오른쪽 옆 표 「합계」를 읽던 것)을 확정본 파일에서 다시 */
function lgReread(vk){
  var ym = lgYM(), d = doneOf(vk, ym), m = d && d.id ? ((ALLBOX || {})[ym] || {})[d.id] : null; if (!m){ toast('확정본 파일을 못 찾았습니다'); return; }
  toast('확정본 여는 중…');
  decryptBox(m).then(function(b){ var A = SETTLE_STMT.analyze(XLSX.read(b, { type: 'array', cellFormula: true })), t = A.totals.total != null ? A.totals.total : (A.totals.sub != null ? A.totals.sub * 1.1 : null);
    if (!t){ alert('확정본에서도 합계를 못 읽었습니다 — 정산금액 칸에 직접 넣어 주세요'); return; }
    t = Math.round(t); if (!confirm(vk + ' ' + ymLabel(ym) + ' 확정본 합계 ' + t.toLocaleString() + '원 — 이 값으로 고칠까요?')) return;
    return db.ref('settlement/vendors/' + vk + '/done/' + ym + '/total').set(t).then(function(){ if (VENDORS[vk] && VENDORS[vk].done && VENDORS[vk].done[ym]) VENDORS[vk].done[ym].total = t; renderLedger(); toast('✔ 합계 ' + t.toLocaleString() + '원'); });
  }).catch(function(e){ alert('다시 읽기 실패: ' + ((e && (e.code || e.message)) || e)); });
}
function lgDownload(vk){
  var ym = lgYM(), V = monthVendors(ym).filter(function(v){ return v.vk === vk; })[0] || { name: vk }, F = lgFinal(vk, V.name, ym); if (!F){ toast('거래내역서 파일을 못 찾았습니다'); return; }
  var name = F.m.name, des = LG_OPT.design || 'orig', I = LINFO[vk] || {};
  var save = function(buf, fn){ var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  toast('거래내역서 여는 중…');
  decryptBox(F.m).then(function(bytes){
    if (des === 'orig'){ save(bytes, name); toast('📄 원본 양식 내려받음'); return; }
    if (/\.xls$/i.test(name)){ var x = XLSX.read(bytes, { type: 'array', cellStyles: true }); bytes = new Uint8Array(XLSX.write(x, { type: 'array', bookType: 'xlsx' })); }
    var D = SETTLE_DESIGN.list.filter(function(d){ return d.id === des; })[0];
    return SETTLE_DESIGN.build(bytes, des, { vendor: V.name, corp: I.corp || V.name.replace(/\(.*\)$/, ''), ym: ym, mail: I.mail1 || I.mail || '', hideZero: !!LG_OPT.hideZero }).then(function(R){
      save(R.buf, name.replace(/\.(xlsx|xls)$/i, '') + '_' + (D ? D.name.split(' · ')[0].replace(/\s/g, '') : des) + '.xlsx');
      toast('📄 ' + (D ? D.name : des) + ' 내려받음' + (R.warn.length ? ' — ' + R.warn.join(' / ') : ''));
    });
  }).catch(function(e){ alert('내려받기 실패: ' + ((e && (e.code || e.message)) || e)); console.error(e); });
}
function lgInfo(vk){
  var I = LINFO[vk] || {}, ov = document.getElementById('lgOv'); if (ov) ov.remove();
  var F = [['mail', '정산서 전달메일'], ['biz', '사업자번호'], ['corp', '공급받는자 상호'], ['ceo', '공급받는자 성명'], ['addr', '사업장 주소'], ['btype', '업태'], ['bitem', '종목'], ['mail1', '이메일1 (계산서)'], ['mail2', '이메일2']];
  ov = document.createElement('div'); ov.id = 'lgOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:560px;width:100%;margin:0"><div class="card-h"><span class="card-t">⚙ ' + esc(vk) + ' — 전달메일 · 세금계산서용 정보</span><button class="btn" style="margin-left:auto" onclick="document.getElementById(\'lgOv\').remove()">닫기</button></div>'
    + F.map(function(f){ return '<div style="display:flex;gap:.6rem;align-items:center;margin:.35rem 0"><span class="sm" style="width:120px">' + f[1] + '</span><input type="text" class="famt" style="flex:1" value="' + esc(I[f[0]] || '') + '" onchange="lgSet(\'ledgerInfo/' + esc(vk) + '/' + f[0] + '\', this.value.trim())"></div>'; }).join('')
    + '<div class="sm dim" style="margin-top:.5rem">고치면 바로 저장 · 다음 달에도 그대로 · 디자인 거래명세서의 공급받는자 상호로도 씀</div></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
}
function lgAddExtra(){ var n = prompt('기타 거래처 이름 (예: (주)영우컴퍼니, 알바도급비, 운송비)', ''); if (!n || !n.trim()) return; db.ref('settlement/ledgerExtra/' + lgYM()).push({ name: n.trim(), at: firebase.database.ServerValue.TIMESTAMP }); }
function lgDelExtra(id){ var ym = lgYM(), x = (LEXTRA[ym] || {})[id]; if (!x || !confirm('「' + (x.name || '') + '」 줄을 지울까요?')) return; db.ref('settlement/ledgerExtra/' + ym + '/' + id).set(null); }

/* ── 엑셀에서 가져오기 ── */
function lgNorm(s){ return String(s || '').replace(/㈜|\(주\)|주식회사|\s/g, ''); }
function lgAliasKey(s){ return lgNorm(s).replace(/[.#$\/\[\]]/g, '_') || '_'; }
/* 관리표 업체명 → 업체: ① 기억한 연결 ② 정산금액이 그 달 확정본·거래내역서 합계와 같은 업체(±1원) ③ 이름 — 아직 안 쓴 업체만, 괄호(구분)가 한쪽에만 있으면 안 맞는 걸로
   (관리표 이름은 법인명이라 정산서 이름과 다름: 씨엘에프 = 포인트나인크루 본 정산, 포인트나인크루 = 용차비 → 금액이 더 확실) */
function lgMatch(name, amt, V, used, amtOf, alias){
  var ak = alias && alias[lgAliasKey(name)]; if (ak){ var av = V.filter(function(v){ return v.vk === ak && !used[v.vk]; })[0]; if (av) return { v: av, how: 'alias' }; }
  if (amt > 0){ var hit = V.filter(function(v){ var a = amtOf(v); return !used[v.vk] && a != null && Math.abs(a - amt) <= 1; }); if (hit.length === 1) return { v: hit[0], how: 'amt' }; }
  var n = lgNorm(name), core = n.replace(/\(.*\)/, ''), par = (n.match(/\(([^)]*)\)/) || [])[1] || '', best = null, bs = 0, cands = [];
  V.forEach(function(v){ if (used[v.vk]) return; var m = lgNorm(v.name), mc = m.replace(/\(.*\)/, ''), mp = (m.match(/\(([^)]*)\)/) || [])[1] || '', s = 0;
    if (m === n) s = 10; else if (mc && core && (mc.indexOf(core) >= 0 || core.indexOf(mc) >= 0 || window.vendorMatcher(v.name)(name))){
      if (par && mp){ var common = par.split('').filter(function(ch){ return mp.indexOf(ch) >= 0; }).length; s = common >= 2 ? 6 + common / 10 : 0; }
      else s = par ? 0 : 3; }
    if (s >= 3) cands.push(v);
    if (s > bs || (s === bs && s > 0 && best && v.name.length < best.name.length)){ bs = s; best = v; } });   /* 같은 점수면 짧은(기본) 이름 — 탑프레쉬_당월분 > 탑프레쉬_7월 미청구분 */
  /* 같은 이름 정산서가 여러 개고(탑프레쉬 당월분 + 7월 미청구분) 그 합이 정산금액이면 → 전부 이 줄 */
  if (amt > 0 && cands.length > 1){ var sum = cands.reduce(function(t, v){ return t + (amtOf(v) || 0); }, 0); if (Math.abs(sum - amt) <= 2) return { v: cands, how: 'sum' }; }
  return bs >= 3 ? { v: best, how: bs >= 10 ? 'exact' : 'name' } : null;
}
function lgImport(input){
  var f = input.files[0]; input.value = ''; if (!f) return;
  f.arrayBuffer().then(function(b){
    var wb = XLSX.read(b, { type: 'array' });
    var all = wb.SheetNames.map(function(n){ var m = n.replace(/\s/g, '').match(/^(\d{2})_(\d{2})월정산분$/); return m ? { sn: n, ym: '20' + m[1] + '-' + m[2] } : null; }).filter(Boolean)
      .sort(function(a, b){ return b.ym.localeCompare(a.ym); });   /* 최근 달부터 — 금액으로 맞춘 연결을 지난달 시트에 씀 */
    if (!all.length){ alert('「YY_MM월정산분」 시트가 없습니다 (있는 시트: ' + wb.SheetNames.slice(0, 6).join(', ') + ' …)'); return; }
    var cur = lgYM(), one = all.filter(function(s){ return s.ym === cur; });
    var pick = all.length > 1 && confirm('관리표에 달 시트가 ' + all.length + '개 있습니다 (' + all[all.length - 1].ym + ' ~ ' + all[0].ym + ').\n\n확인 = 모두 가져오기\n취소 = 지금 보는 ' + ymLabel(cur) + '만') ? all : one;
    if (!pick.length){ alert(ymLabel(cur) + ' 시트(「' + cur.slice(2, 4) + '_' + cur.slice(5, 7) + '월정산분」)가 없습니다'); return; }
    var up = {}, alias = Object.assign({}, LALIAS), sum = [], o = function(v){ return String(v).trim().toLowerCase() === 'o'; };
    pick.forEach(function(P){
      var a = XLSX.utils.sheet_to_json(wb.Sheets[P.sn], { header: 1, defval: '', raw: true }), hi = a.findIndex(function(r){ return String(r[1]).replace(/\s/g, '') === '업체명'; });
      if (hi < 0){ sum.push(P.ym + ' 제목줄 없음'); return; }
      var ym = P.ym, V = monthVendors(ym), used = {}, nV = 0, nX = 0, group = '', amtOf = function(v){ var A = lgAuto(v.vk, v.name, ym); return A ? A.v : null; };
      for (var i = hi + 1; i < a.length; i++){ var r = a[i], nm = String(r[1] || '').trim(); if (String(r[0]).trim()) group = String(r[0]).trim(); if (!nm) continue;   /* 합계 줄·아래 비용 표는 업체명 칸이 비어 있음 */
        var E = typeof r[4] === 'number' ? r[4] : null;
        var st = { sent: o(r[6]) || null, inv: o(r[7]) || null, chk: o(r[8]) || null, paid: o(r[9]) || null, carry: typeof r[3] === 'number' && r[3] ? r[3] : null,
          send: typeof r[5] === 'number' && r[5] ? r[5] : null,   /* F 송금토스금액 = 우리가 보내는 돈 */
          memo: typeof r[5] === 'string' && r[5].trim() ? r[5].trim() : (typeof r[10] === 'number' ? '관리표 합계칸 ' + r[10] : null), xlName: nm };
        var info = { group: group || null, mail: String(r[2] || '').trim() || null, biz: String(r[12] || '').trim() || null, corp: String(r[14] || '').trim() || null, ceo: String(r[15] || '').trim() || null, addr: String(r[16] || '').trim() || null,
          btype: String(r[17] || '').trim() || null, bitem: String(r[18] || '').trim() || null, mail1: String(r[19] || '').trim() || null, mail2: String(r[20] || '').trim() || null };
        var M = lgMatch(nm, E || 0, V, used, amtOf, alias), L = M ? [].concat(M.v) : [];
        L.forEach(function(v){ used[v.vk] = 1; nV++;
          Object.keys(st).forEach(function(k){ up['ledger/' + ym + '/' + v.vk + '/' + k] = st[k]; });
          up['ledger/' + ym + '/' + v.vk + '/amount'] = L.length === 1 ? E : null;   /* 확정본·거래내역서가 없을 때 쓰는 관리표 금액 */
          Object.keys(info).forEach(function(k){ if (info[k] != null && !(LINFO[v.vk] || {})[k]) up['ledgerInfo/' + v.vk + '/' + k] = info[k]; }); });
        if (M && L.length === 1 && (M.how === 'amt' || M.how === 'exact' || M.how === 'name') && lgNorm(nm) !== lgNorm(L[0].name)){ alias[lgAliasKey(nm)] = L[0].vk; up['ledgerAlias/' + lgAliasKey(nm)] = L[0].vk; }
        if (!L.length){ nX++; var id = 'x' + ym.replace('-', '') + '_' + i; up['ledgerExtra/' + ym + '/' + id] = Object.assign({ name: nm, group: group || null, mail: info.mail, amount: E }, st); }
      }
      sum.push(ym + ' 업체 ' + nV + ' · 기타 ' + nX);
    });
    if (!confirm('관리표에서 가져옵니다:\n\n' + sum.join('\n') + '\n\n같은 달에 이미 넣은 체크·입금·메모는 엑셀 값으로 바뀝니다 (업체 정보는 비어 있는 칸만 채움). 계속할까요?')) return;
    return db.ref('settlement').update(up).then(function(){ toast('📥 ' + pick.length + '개 달 가져옴'); });
  }).catch(function(e){ alert('가져오기 실패: ' + ((e && e.message) || e)); console.error(e); });
}
/* ── 엑셀로 내보내기: 원래 관리표 열 그대로 ── */
function lgExport(){
  var ym = lgYM();
  var H = ['관리업체', '업체명', '정산서전달메일', '전미수금액', '정산금액', '송금토스금액', '1.정산서전달', '2.계산서발행', '3.체크완료', '4.업체송금', '미수', '', '사업자번호', '공급받는자 종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소', '공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2', '공급가액', '세액', '비고', '일자1 (2자리, 작성년월 제외)', '품목1', '규격1', '수량1', '단가1', '공급가액1', '세액1'];
  var aoa = [['입금  계좌: 기업은행  568-025968-04-010', '', '경기도 김포시 황금3로 7번길 42'], ['예  금  주: 메이크마인디자인㈜'], H], dd = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  var V = monthVendors(ym), X = LEXTRA[ym] || {}, oo = function(b){ return b ? 'o' : ''; };
  V.forEach(function(v){ var s = lgState('v', v.vk, ym, 0, v.name), I = LINFO[v.vk] || {}, rec = s.rec; if (v.skip && !s.amt) return; if (!s.amt && !s.carry && !rec.send && !rec.sent) return; var sup = s.amt != null ? s.amt / 1.1 : '';
    aoa.push([I.group || '', v.name, I.mail || '', s.carry || '', s.amt != null ? s.amt : '', rec.send != null ? rec.send : (rec.memo || ''), oo(rec.sent), oo(rec.inv), oo(rec.chk), oo(rec.paid), s.unpaid || '', '',
      I.biz || '', '', I.corp || '', I.ceo || '', I.addr || '', I.btype || '', I.bitem || '', I.mail1 || '', I.mail2 || '', sup === '' ? '' : Math.round(sup), sup === '' ? '' : Math.round(s.amt - sup), '', dd, '포장재 외', '', '', '', sup === '' ? '' : Math.round(sup), sup === '' ? '' : Math.round(s.amt - sup)]); });
  Object.keys(X).forEach(function(id){ var s = lgState('x', id, ym, 0), x = X[id];
    aoa.push([x.group || '', x.name || '', x.mail || '', s.carry || '', x.amount != null ? x.amount : '', x.send != null ? x.send : (x.memo || ''), oo(x.sent), oo(x.inv), oo(x.chk), oo(x.paid), s.unpaid || '']); });
  var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = H.map(function(h, i){ return { wch: i === 1 ? 30 : i === 2 ? 28 : i === 16 ? 40 : 12 }; });
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, ym.slice(2, 4) + '_' + ym.slice(5, 7) + '월정산분');
  XLSX.writeFile(wb, '00_삼자물류정산관리_' + ym.slice(5, 7) + '월.xlsx');
}
