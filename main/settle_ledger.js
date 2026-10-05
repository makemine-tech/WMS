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
  lgCostListen();
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
  /* 미확정(초안) = 업체 정산 탭에서 「초안 내려받기」 한 포함가 (run/{ym}/draft.total) — 확정 전이라도 금액은 들어감 (대표님 2026-10-05) */
  var dr = ((((VENDORS[vk] || {}).run) || {})[ym] || {}).draft, dv = dr && +dr.total ? +dr.total : null;
  var d = doneOf(vk, ym); if (d && +d.total) return { v: +d.total, src: '확정본' };
  if (d && d.id) return { v: dv, src: dv ? '미확정(초안)' : '', reread: true };   /* 확정했는데 합계가 0·없음 → 「합계 다시 읽기」 */
  var st = (VENDORS[vk] || {}).stat, S = lgStmt(name, ym);
  if (st && st.total != null && S && st.sid && String(st.sid).indexOf(S.id) >= 0) return { v: +st.total, src: '거래내역서' };
  if (dv) return { v: dv, src: '미확정(초안)' };
  return null;
}
function lgState(kind, key, ym, depth, name){
  var rec = kind === 'v' ? ((LEDGER[ym] || {})[key] || {}) : ((LEXTRA[ym] || {})[key] || {});
  var A = kind === 'v' ? lgAuto(key, name || key, ym) : null, man = rec.amount != null && rec.amount !== '' ? +rec.amount : null;
  var reread = !!(A && A.reread); if (reread && A.v == null) A = null;
  if (A && man != null && A.src !== '확정본') A = null;   /* 관리표·직접 금액이 거래내역서·초안보다 먼저 (트립인터 0원·박스앤캔 자체비용처럼 정산서는 있어도 청구 안 하는 곳) */
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
function lgTh(k, t, cls){ var S = LG_OPT.sort || {}, on = S.k === k; return '<th' + (cls ? ' class="' + cls + '"' : '') + ' style="cursor:pointer;user-select:none;white-space:nowrap' + (on ? ';color:var(--b)' : '') + '" onclick="lgSort(\'' + k + '\')" title="눌러서 정렬 (한 번 더 = 반대로)">' + t + (on ? (S.d > 0 ? ' ▲' : ' ▼') : ' <span style="opacity:.35">↕</span>') + '</th>'; }
function lgSort(k){ var S = LG_OPT.sort || {}; lgOpt('sort', S.k === k ? { k: k, d: -S.d } : { k: k, d: k === 'amt' || k === 'unpaid' ? -1 : 1 }); renderLedger(); }
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
  /* 제목 눌러 정렬 (대표님 2026-10-05): 업체명·관리업체·정산금액·진행·미수 — 같은 칸 다시 누르면 반대로 */
  var SO = LG_OPT.sort; if (SO && SO.k){ var kv = { name: function(r){ return r.name; }, group: function(r){ return r.group || ''; }, amt: function(r){ return r.s.amt || 0; }, stage: function(r){ return lgStage(r.s.rec); }, unpaid: function(r){ return r.s.unpaid || 0; } }[SO.k];
    if (kv) rows.sort(function(a, b){ var x = kv(a), y = kv(b), c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko'); return c * SO.d || a.name.localeCompare(b.name, 'ko'); }); }
  window._lgRows = rows;
  var act = rows.filter(function(r){ return !r.skip && (r.s.amt || r.s.carry || r.s.rec.send); });
  var S = { amt: 0, paid: 0, unpaid: 0, send: 0, n: act.length, st: [0, 0, 0, 0], pd: 0 };
  act.forEach(function(r){ S.amt += r.s.amt || 0; S.paid += r.s.paid || 0; S.send += +r.s.rec.send || 0; S.unpaid += r.s.unpaid > 0 ? r.s.unpaid : 0; for (var k = 1; k <= lgStage(r.s.rec); k++) S.st[k]++; if ((r.s.amt || r.s.carry) && r.s.unpaid <= 0) S.pd++; });
  var CO = lgCosts(ym), PF = S.amt - S.send - CO.total;   /* 수익 = 청구 − 송금·토스 − 지출 */
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
    + '<button class="btn" style="white-space:nowrap;font-size:12px" onclick="lgExportXl()">📤 내보내기</button><button class="btn" style="white-space:nowrap;font-size:12px" onclick="lgAddExtra()">＋ 기타 거래처</button><button class="btn p" style="white-space:nowrap;font-size:12px" onclick="lgCostOpen()">💸 고정비·지출</button></div>'
    + '<div class="lg-cards">'
    + card('정산 업체', S.n + '곳', '금액 있는 곳') + card('청구 합계 (VAT 포함)', '₩' + won0(S.amt), '공급가 ₩' + won0(S.amt / 1.1))
    + card('송금·토스 (보낼 돈)', '₩' + won0(S.send), '관리표 송금토스') + card('입금 완료', '₩' + won0(S.paid), S.pd + ' / ' + S.n + '곳', 'var(--g)') + card('미수 합계', '₩' + won0(S.unpaid), '전미수 포함', S.unpaid ? '#f87171' : 'var(--g)')
    + card('지출 (고정·일시)', '₩' + won0(CO.total), CO.nEst ? '예상 ' + CO.nEst + '개 포함 — 💸 에서 확정' : '모두 확정', CO.nEst ? '#fbbf24' : '')
    + card('수익 · 수익률', '₩' + won0(PF), (S.amt ? (PF / S.amt * 100).toFixed(1) + '%' : '-') + ' · 청구−송금−지출', PF >= 0 ? 'var(--g)' : '#f87171')
    + card('진행', '전달 ' + S.st[1] + ' · 계산서 ' + S.st[2], '체크 ' + S.st[3] + ' / ' + S.n) + '</div>'
    + '<div style="display:flex;gap:.45rem;align-items:center;margin:0 0 .4rem;flex-wrap:wrap"><button class="btn" style="font-size:12px" onclick="lgBulk(1)">✉️ 일괄 전달완료</button><button class="btn" style="font-size:12px" onclick="lgBulk(2)">🧾 일괄 계산서발행완료</button>'
    + '<span class="sp" style="flex:1"></span><span class="sm dim">내려받기 모양</span> ' + dsel + ' <label class="sm"><input type="checkbox" ' + (LG_OPT.hideZero ? 'checked' : '') + ' onchange="lgOpt(\'hideZero\', this.checked)"> 0원 줄 숨기기</label></div>'
    + '<div id="lgScroll"><table class="ftbl lgt"><thead><tr>' + lgTh('name', '업체명', 'stk') + lgTh('group', '관리업체') + '<th class="n">전미수</th>' + lgTh('amt', '정산금액', 'n') + '<th class="n">송금·토스</th><th class="n">입금액</th>'
    + lgTh('stage', '진행') + lgTh('unpaid', '미수', 'n') + '<th>거래내역서</th><th>메모</th><th></th></tr></thead><tbody>';
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
  var bytes;
  f.arrayBuffer().then(function(b){
    bytes = b; var wb = XLSX.read(b, { type: 'array' });
    var all = wb.SheetNames.map(function(n){ var m = n.replace(/\s/g, '').match(/^(\d{2})_(\d{2})월정산분$/); return m ? { sn: n, ym: '20' + m[1] + '-' + m[2] } : null; }).filter(Boolean)
      .sort(function(a, b){ return b.ym.localeCompare(a.ym); });   /* 최근 달부터 — 금액으로 맞춘 연결을 지난달 시트에 씀 */
    if (!all.length){ alert('「YY_MM월정산분」 시트가 없습니다 (있는 시트: ' + wb.SheetNames.slice(0, 6).join(', ') + ' …)'); return; }
    var cur = lgYM(), one = all.filter(function(s){ return s.ym === cur; });
    var pick = all.length > 1 && confirm('관리표에 달 시트가 ' + all.length + '개 있습니다 (' + all[all.length - 1].ym + ' ~ ' + all[0].ym + ').\n\n확인 = 모두 가져오기\n취소 = 지금 보는 ' + ymLabel(cur) + '만') ? all : one;
    if (!pick.length){ alert(ymLabel(cur) + ' 시트(「' + cur.slice(2, 4) + '_' + cur.slice(5, 7) + '월정산분」)가 없습니다'); return; }
    toast('관리표 모양 읽는 중…');
    var xwb = new ExcelJS.Workbook();
    return xwb.xlsx.load(bytes).then(function(){
      var pal = lgThemePal(xwb), up = {}, alias = Object.assign({}, LALIAS), sum = [], o = function(v){ return String(v).trim().toLowerCase() === 'o'; }, styled = {}, newestDone = false;
      pick.forEach(function(P){
        var a = XLSX.utils.sheet_to_json(wb.Sheets[P.sn], { header: 1, defval: '', raw: true, blankrows: true }), hi = a.findIndex(function(r){ return String(r[1]).replace(/\s/g, '') === '업체명'; });
        if (hi < 0){ sum.push(P.ym + ' 제목줄 없음'); return; }
        /* 모양: 합계 줄 = 제목 아래 처음으로 E칸이 SUM 수식인 줄 */
        var xws = xwb.getWorksheet(P.sn), sumRow = 0;
        if (xws) for (var rr = hi + 2; rr <= xws.rowCount; rr++){ var ev = xws.getRow(rr).getCell(5).value; if (ev && ev.formula && /^SUM\(/i.test(ev.formula)){ sumRow = rr; break; } }
        var cap = xws && sumRow ? lgCaptureSheet(xws, pal, hi, sumRow - 1, !newestDone) : null;
        if (cap){ if (cap.head){ up['ledgerTpl/_head'] = cap.head; newestDone = true; } up['ledgerTpl/' + P.ym] = { tail: cap.tail }; }
        var ym = P.ym, V = monthVendors(ym), used = {}, nV = 0, nX = 0, group = '', amtOf = function(v){ var A = lgAuto(v.vk, v.name, ym); return A ? A.v : null; };
        for (var i = hi + 1; i < a.length; i++){ var r = a[i], nm = String(r[1] || '').trim(), xr = i + 1; if (String(r[0]).trim()) group = String(r[0]).trim();
          if (sumRow && xr >= sumRow) break;   /* 합계 줄부터 아래는 비용표 */
          if (!nm) continue;
          var E = typeof r[4] === 'number' ? r[4] : null, xs = cap ? cap.rowStyle[xr] || null : null;
          var st = { sent: o(r[6]) || null, inv: o(r[7]) || null, chk: o(r[8]) || null, paid: o(r[9]) || null, carry: typeof r[3] === 'number' && r[3] ? r[3] : null,
            send: typeof r[5] === 'number' && r[5] ? r[5] : null,   /* F 송금토스금액 = 우리가 보내는 돈 */
            memo: typeof r[5] === 'string' && r[5].trim() ? r[5].trim() : (typeof r[10] === 'number' ? '관리표 합계칸 ' + r[10] : null), xlName: nm };
          var info = { group: group || null, mail: String(r[2] || '').trim() || null, biz: String(r[12] || '').trim() || null, corp: String(r[14] || '').trim() || null, ceo: String(r[15] || '').trim() || null, addr: String(r[16] || '').trim() || null,
            btype: String(r[17] || '').trim() || null, bitem: String(r[18] || '').trim() || null, mail1: String(r[19] || '').trim() || null, mail2: String(r[20] || '').trim() || null };
          var M = lgMatch(nm, E || 0, V, used, amtOf, alias), L = M ? [].concat(M.v) : [];
          L.forEach(function(v){ used[v.vk] = 1; nV++;
            Object.keys(st).forEach(function(k){ up['ledger/' + ym + '/' + v.vk + '/' + k] = st[k]; });
            up['ledger/' + ym + '/' + v.vk + '/amount'] = L.length === 1 ? E : null;   /* 확정본·거래내역서가 없을 때 쓰는 관리표 금액 */
            Object.keys(info).forEach(function(k){ if (info[k] != null && !(LINFO[v.vk] || {})[k]) up['ledgerInfo/' + v.vk + '/' + k] = info[k]; });
            if (!styled[v.vk] && xs){ styled[v.vk] = 1; up['ledgerInfo/' + v.vk + '/xs'] = xs; up['ledgerInfo/' + v.vk + '/ord'] = xr; up['ledgerInfo/' + v.vk + '/xlName'] = nm; } });   /* 모양·줄 순서 = 가장 최근 달 관리표 */
          if (M && L.length === 1 && (M.how === 'amt' || M.how === 'exact' || M.how === 'name') && lgNorm(nm) !== lgNorm(L[0].name)){ alias[lgAliasKey(nm)] = L[0].vk; up['ledgerAlias/' + lgAliasKey(nm)] = L[0].vk; }
          if (!L.length){ nX++; var id = 'x' + ym.replace('-', '') + '_' + i; up['ledgerExtra/' + ym + '/' + id] = Object.assign({ name: nm, group: group || null, mail: info.mail, amount: E, xs: xs, ord: xr }, st); }
        }
        /* 아래 비용표(E 항목 · F 금액, 「수익금액」 줄 전까지) → 그 달 고정 지출 (확정) */
        var nC = 0; if (sumRow) for (var ci = sumRow; ci < a.length; ci++){ var cr = a[ci], lab = String(cr[4] == null ? '' : cr[4]).trim(); if (/^수익금액/.test(lab)) break; if (!lab || typeof cr[4] === 'number' || typeof cr[5] !== 'number' || /추가필요매출/.test(lab)) continue;
          up['ledgerCost/' + ym + '/c' + (ci + 1)] = { kind: '고정', name: lab, amount: cr[5], ok: true, ord: ci + 1, xl: true }; nC++; }
        sum.push(ym + ' 업체 ' + nV + ' · 기타 ' + nX + ' · 지출 ' + nC + (cap ? '' : ' (모양 못 읽음)'));
      });
      if (!confirm('관리표에서 가져옵니다 (색·모양 포함):\n\n' + sum.join('\n') + '\n\n같은 달에 이미 넣은 체크·입금·메모는 엑셀 값으로 바뀝니다 (업체 정보는 비어 있는 칸만 채움). 계속할까요?')) return;
      return db.ref('settlement').update(up).then(function(){ toast('📥 ' + pick.length + '개 달 가져옴 (모양 포함)'); });
    });
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

/* ═══ 관리표 모양 그대로 내보내기 (대표님 2026-10-05: 「내보내기 = 기존 엑셀과 같은 색·내용」) ═══
   관리표 엑셀을 가져올 때 모양도 같이 저장 → 내보낼 때 그 모양으로 다시 그림
     settlement/ledgerTpl/_head = { widths, hidden, heights, rows:[[제목 1~3줄 칸들]], def:{열: 보통 줄 칸 모양}, zoom }
     settlement/ledgerTpl/{ym}  = { tail:[[합계 줄부터 아래 비용표 칸들]], first, last, tailStart }   (그 달 관리표 아래쪽 그대로)
     업체 줄 모양 = ledgerInfo/{업체키}/xs (열별 칸 모양) · ord(관리표 줄 순서) — 기타 거래처는 그 줄 기록에 xs·ord
   칸 모양 = { f:채움 ARGB, c:글자색, b:굵게, s:크기, n:글꼴, nf:숫자모양, h:가로정렬, w:줄바꿈, bd:'tblr' 선 }  (테마색은 RGB 로 풀어서) */
var LG_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '5B9BD5', 'ED7D31', 'A5A5A5', 'FFC000', '4472C4', '70AD47'];
function lgThemePal(wb){
  try { var t = wb._themes && (wb._themes.theme1 || Object.keys(wb._themes).map(function(k){ return wb._themes[k]; })[0]); if (!t) return LG_THEME;
    var g = function(k){ var m = String(t).match(new RegExp('<a:' + k + '>[\\s\\S]*?(?:srgbClr val="(\\w{6})"|lastClr="(\\w{6})")')); return m ? (m[1] || m[2]) : null; };
    var p = [g('lt1'), g('dk1'), g('lt2'), g('dk2'), g('accent1'), g('accent2'), g('accent3'), g('accent4'), g('accent5'), g('accent6')];
    return p.map(function(x, i){ return x || LG_THEME[i]; });
  } catch (e) { return LG_THEME; }
}
function lgTint(hex, tint){   /* 엑셀 tint = HSL 밝기 조정 */
  var r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
  if (d){ s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  var f = function(p, q, t){ if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  var q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, R = s ? f(p, q, h + 1 / 3) : l, G = s ? f(p, q, h) : l, B = s ? f(p, q, h - 1 / 3) : l;
  return [R, G, B].map(function(v){ return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join('').toUpperCase();
}
function lgArgb(c, pal){ if (!c) return null; if (c.argb) return c.argb.length === 8 ? c.argb : 'FF' + c.argb; if (c.theme != null){ var base = pal[c.theme] || '000000'; return 'FF' + (c.tint ? lgTint(base, c.tint) : base); } return null; }
function lgCellStyle(c, pal){
  var o = {}, fl = c.fill, fo = c.font || {}, al = c.alignment || {}, bd = c.border || {};
  if (fl && fl.type === 'pattern' && fl.pattern && fl.pattern !== 'none'){ var a = lgArgb(fl.fgColor, pal); if (a) o.f = a; }
  var fc = lgArgb(fo.color, pal); if (fc && fc !== 'FF000000') o.c = fc;
  if (fo.bold) o.b = 1; if (fo.size) o.s = fo.size; if (fo.name) o.n = fo.name;
  if (c.numFmt && c.numFmt !== 'General') o.nf = c.numFmt; if (al.horizontal) o.h = al.horizontal; if (al.wrapText) o.w = 1;
  var B = ['top', 'bottom', 'left', 'right'].map(function(k){ return bd[k] && bd[k].style ? bd[k].style.charAt(0) + (bd[k].style === 'medium' ? 'm' : '') : '-'; }).join(',');
  if (B !== '-,-,-,-') o.bd = B;
  return o;
}
function lgApply(cell, o){
  if (!o) return; var BS = { t: 'thin', h: 'hair', mm: 'medium', d: 'dotted', 'do': 'double' };
  if (o.f) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.f } };
  cell.font = { name: o.n || '맑은 고딕', size: o.s || 11, bold: !!o.b, color: { argb: o.c || 'FF000000' } };
  if (o.nf) cell.numFmt = o.nf; if (o.h || o.w) cell.alignment = { horizontal: o.h, vertical: 'middle', wrapText: !!o.w };
  if (o.bd){ var p = o.bd.split(','), sides = {}; ['top', 'bottom', 'left', 'right'].forEach(function(k, i){ var v = p[i]; if (v && v !== '-') sides[k] = { style: BS[v] || (v === 'm' ? 'medium' : 'thin') }; }); cell.border = sides; }
}
function lgRowStyle(row, pal, n){ var s = {}; for (var c = 1; c <= n; c++){ var o = lgCellStyle(row.getCell(c), pal); if (Object.keys(o).length) s[c] = o; } return s; }
function lgCellVal(c){ var v = c.value; if (v == null) return null; if (v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v.text != null && v.hyperlink) return v.text; if (v.formula || v.sharedFormula) return { f: v.formula || null, r: v.result != null ? v.result : null }; if (v instanceof Date) return v.toISOString().slice(0, 10); return v; }
/* 가져오기 때: 그 시트 모양 저장할 것 만들기 → { head, tail, rowStyle(줄번호→모양) } */
function lgCaptureSheet(xws, pal, hi, lastData, newest){
  var N = 31, out = { rowStyle: {} };
  for (var r = hi + 2; r <= lastData; r++) out.rowStyle[r] = lgRowStyle(xws.getRow(r), pal, N);
  /* 아래 = 합계 줄부터 끝까지 (값·수식·모양) */
  var tail = [], end = xws.rowCount;
  for (var r2 = lastData + 1; r2 <= end; r2++){ var row = xws.getRow(r2), cells = {};
    for (var c = 1; c <= N; c++){ var cell = row.getCell(c), v = lgCellVal(cell), st = lgCellStyle(cell, pal); if (v != null || Object.keys(st).length) cells[c] = { v: v, st: st }; }
    tail.push({ h: row.height || null, c: cells }); }
  out.tail = { first: hi + 2, last: lastData, start: lastData + 1, rows: tail, blank: {} };
  /* 업체명 없는 빈 줄(묶음 사이 색 칠한 칸)도 그 자리 그대로 */
  for (var rb = hi + 2; rb <= lastData; rb++){ var brow = xws.getRow(rb), bv = lgCellVal(brow.getCell(2)); if (bv != null && String(bv).trim()) continue;
    var bc = {}; for (var cb = 1; cb <= N; cb++){ var bcell = brow.getCell(cb), bvv = lgCellVal(bcell), bst = lgCellStyle(bcell, pal); if (bvv != null || Object.keys(bst).length) bc[cb] = { v: bvv, st: bst }; }
    out.tail.blank[rb] = bc; }
  if (newest){
    var head = { widths: [], hidden: [], rows: [], heights: [], zoom: (xws.views && xws.views[0] && xws.views[0].zoomScale) || 85, def: lgRowStyle(xws.getRow(hi + 2), pal, N) };
    for (var c2 = 1; c2 <= N; c2++){ var col = xws.getColumn(c2); head.widths.push(col.width || 10); head.hidden.push(col.hidden ? 1 : 0); }
    for (var r3 = 1; r3 <= hi + 1; r3++){ var rw = xws.getRow(r3), cs = {}; head.heights.push(rw.height || null);
      for (var c3 = 1; c3 <= N; c3++){ var ce = rw.getCell(c3), vv = lgCellVal(ce), s3 = lgCellStyle(ce, pal); if (vv != null || Object.keys(s3).length) cs[c3] = { v: vv, st: s3 }; } head.rows.push(cs); }
    out.head = head;
  }
  return out;
}
/* 내보내기: 저장한 모양으로 관리표 시트 다시 그리기 */
function lgExportXl(){   /* 저장한 모양은 내보낼 때만 읽음 (아래쪽 비용표가 달마다 있어 페이지 열 때 다 읽지 않게) */
  var ym = lgYM(), H = null, T = null;
  toast('관리표 모양 읽는 중…');
  db.ref('settlement/ledgerTpl/_head').get().then(function(s){ H = s.val();
    var tries = [], y = +ym.slice(0, 4), m = +ym.slice(5, 7); for (var i = 0; i < 13; i++){ tries.push(y + '-' + String(m).padStart(2, '0')); m--; if (!m){ m = 12; y--; } }   /* 그 달 아래쪽이 없으면 가장 가까운 지난달 것 */
    return tries.reduce(function(p, k){ return p.then(function(){ if (T) return; return db.ref('settlement/ledgerTpl/' + k).get().then(function(t){ if (t.exists()){ T = t.val(); T._ym = k; } }); }); }, Promise.resolve());
  }).then(function(){ lgExportXlRun(ym, H, T); }).catch(function(e){ alert('내보내기 실패: ' + ((e && (e.code || e.message)) || e)); });
}
function lgExportXlRun(ym, H, T){
  if (!H){ if (confirm('관리표 모양이 아직 저장되지 않았습니다 — 관리표 엑셀을 한 번 「📥 관리표 가져오기」로 올리면 그 색·모양 그대로 내보냅니다.\n\n지금은 기본 모양으로 내보낼까요?')) lgExport(); return; }
  var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(ym.slice(2, 4) + '_' + ym.slice(5, 7) + '월정산분', { views: [{ zoomScale: H.zoom || 85 }] });
  H.widths.forEach(function(w, i){ var c = ws.getColumn(i + 1); c.width = w; if (H.hidden[i]) c.hidden = true; });
  var put = function(r, c, v, st){ var cell = ws.getRow(r).getCell(c); if (v != null && v !== '') cell.value = v && typeof v === 'object' && v.f !== undefined ? (v.f ? { formula: v.f, result: v.r } : v.r) : v; lgApply(cell, st); return cell; };
  H.rows.forEach(function(cs, i){ var r = i + 1; if (H.heights[i]) ws.getRow(r).height = H.heights[i]; Object.keys(cs).forEach(function(c){ put(r, +c, cs[c].v, cs[c].st); }); });
  var hr = H.rows.length, r0 = hr + 1;
  /* 줄 = 업체(+기타 거래처) — 관리표 줄 순서(ord) 먼저, 새 업체는 뒤에 */
  var V = monthVendors(ym), X = LEXTRA[ym] || {}, L = [], dd = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate(), oo = function(b){ return b ? 'o' : null; };
  V.forEach(function(v){ var s = lgState('v', v.vk, ym, 0, v.name), I = LINFO[v.vk] || {}; if (v.skip && !s.amt) return; if (!s.amt && !s.carry && !s.rec.send && !s.rec.sent && I.ord == null) return;
    L.push({ ord: I.ord != null ? +I.ord : 9000, name: s.rec.xlName || I.xlName || v.name, group: I.group || '', mail: I.mail || '', I: I, s: s, xs: I.xs || null }); });
  Object.keys(X).forEach(function(id){ var x = X[id], s = lgState('x', id, ym, 0); L.push({ ord: x.ord != null ? +x.ord : 9500, name: x.name || '', group: x.group || '', mail: x.mail || '', I: {}, s: s, xs: x.xs || null, extra: 1 }); });
  L.sort(function(a, b){ return a.ord - b.ord || a.name.localeCompare(b.name, 'ko'); });
  /* 자리 = 관리표에 있던 줄 번호 그대로(빈 색칠 줄도 그 자리), 관리표에 없던 업체는 맨 아래에 이어서 */
  var tl = T && T.tail ? T.tail : null, fixedEnd = tl ? tl.last : r0 - 1, pos = {}, nextFree = fixedEnd + 1;
  /* 관리표 한 줄에 정산서 여러 개(탑프레쉬 당월분 + 7월 미청구분)면 → 한 줄로 합침 (금액·전미수·송금·미수 더함) */
  var byOrd = {}; L = L.filter(function(it){ var o = it.ord; if (!tl || it.extra || o < tl.first || o > tl.last) return true; var h = byOrd[o]; if (!h){ byOrd[o] = it; return true; }
    var a = h.s, b = it.s; h.s = Object.assign({}, a, { amt: (a.amt || 0) + (b.amt || 0), carry: (a.carry || 0) + (b.carry || 0), unpaid: (a.unpaid || 0) + (b.unpaid || 0), rec: Object.assign({}, a.rec, { send: (+a.rec.send || 0) + (+b.rec.send || 0) || null }) }); return false; });
  L.forEach(function(it){ var o = it.ord; if (tl && o >= tl.first && o <= tl.last && !pos[o] && !(tl.blank || {})[o]) { pos[o] = it; it.r = o; } else { it.r = nextFree; pos[nextFree] = it; nextFree++; } });
  var last = Math.max(fixedEnd, nextFree - 1), grpOf = {};
  if (tl) Object.keys(tl.blank || {}).forEach(function(k){ var r = +k; if (pos[r]) return; var cs = tl.blank[k]; Object.keys(cs).forEach(function(c){ put(r, +c, cs[c].v, cs[c].st); }); grpOf[r] = cs[1] && cs[1].v ? String(cs[1].v) : ''; });
  L.forEach(function(it){ var r = it.r, s = it.s, rec = s.rec, I = it.I, st = it.xs || H.def || {}, amt = s.amt; grpOf[r] = it.group;
    var paidDone = (amt || s.carry) && s.unpaid <= 0, vals = {
      1: it.group, 2: it.name, 3: it.mail, 4: s.carry || null, 5: amt != null ? amt : null, 6: rec.send != null ? rec.send : (rec.memo || null),
      7: oo(rec.sent), 8: oo(rec.inv), 9: oo(rec.chk), 10: oo(paidDone || rec.paid), 11: s.unpaid > 0 ? s.unpaid : ((amt || s.carry) ? 'o' : null) };
    if (!it.extra){ Object.assign(vals, { 13: I.biz || null, 15: I.corp || null, 16: I.ceo || null, 17: I.addr || null, 18: I.btype || null, 19: I.bitem || null, 20: I.mail1 || null, 21: I.mail2 || null,
      22: amt != null ? { f: 'E' + r + '/1.1', r: amt / 1.1 } : null, 23: amt != null ? { f: 'E' + r + '-V' + r, r: amt - amt / 1.1 } : null, 25: String(dd), 26: amt != null ? '포장재 외' : null,
      30: amt != null ? { f: 'V' + r, r: amt / 1.1 } : null, 31: amt != null ? { f: 'W' + r, r: amt - amt / 1.1 } : null }); }
    for (var c = 1; c <= 31; c++) put(r, c, vals[c], st[c] || (H.def || {})[c]);
  });
  /* 관리업체 칸 — 같은 묶음끼리 세로로 합치기 (원래 관리표처럼) */
  for (var a = r0; a <= last;){ var b = a, g = grpOf[a]; while (g && b + 1 <= last && grpOf[b + 1] === g) b++; if (b > a) try { ws.mergeCells(a, 1, b, 1); } catch (e) {} a = b + 1; }
  /* 아래(합계 줄·비용표) — 그 달 관리표 그대로, 합계 범위·줄 번호만 새 자리로 */
  if (T && T.tail){ var t = T.tail, start = last + 1, delta = start - t.start;
    var adj = function(f){ return String(f).replace(/(\$?[A-Z]{1,3})\$?(\d+)(:\$?([A-Z]{1,3})\$?(\d+))?/g, function(m, c1, n1, rg, c2, n2){ n1 = +n1;
      if (rg){ n2 = +n2; if (n1 <= t.first && n2 >= t.last - 1 && n2 < t.start) return c1 + r0 + ':' + c2 + last; return c1 + (n1 >= t.start ? n1 + delta : n1) + ':' + c2 + (n2 >= t.start ? n2 + delta : n2); }
      return c1 + (n1 >= t.start ? n1 + delta : n1); }); };
    t.rows.forEach(function(row, i){ var r = start + i; if (row.h) ws.getRow(r).height = row.h;
      Object.keys(row.c || {}).forEach(function(c){ var v = row.c[c].v; if (v && typeof v === 'object' && v.f) v = { f: adj(v.f), r: v.r };
        /* 다른 달 비용표를 빌려 쓰면 금액은 이 달 💸 지출 값으로 (이름이 같은 항목) */
        if (T._ym && T._ym !== ym && +c === 6 && typeof v === 'number' && row.c[5] && typeof row.c[5].v === 'string'){ var nm = row.c[5].v.trim(), hit = lgCosts(ym).rows.filter(function(x){ return x.name.trim() === nm; })[0]; v = hit ? hit.amount : null; }
        put(r, +c, v, row.c[c].st); }); });
  } else {   /* 아래쪽 모양이 없으면 합계 줄만 */
    var tr = last + 1; [4, 5, 6, 11].forEach(function(c){ var L2 = ws.getColumn(c).letter; put(tr, c, { f: 'SUM(' + L2 + r0 + ':' + L2 + last + ')', r: null }, { b: 1, nf: '#,##0_ ', h: 'center' }); });
  }
  wb.calcProperties = { fullCalcOnLoad: true };
  wb.xlsx.writeBuffer().then(function(buf){ var aEl = document.createElement('a'); aEl.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    aEl.download = '00_삼자물류정산관리_' + ym.slice(5, 7) + '월.xlsx'; document.body.appendChild(aEl); aEl.click(); setTimeout(function(){ URL.revokeObjectURL(aEl.href); aEl.remove(); }, 2000); toast('📤 관리표 모양으로 내보냄'); })
    .catch(function(e){ alert('내보내기 실패: ' + ((e && e.message) || e)); });
}

/* ═══ 💸 고정비·지출 (대표님 2026-10-05) ═══
   달마다 지출 줄: 구분(고정·일시) · 항목 · 금액 · 확정 — settlement/ledgerCost/{ym}/{id} = { kind, name, amount, ok, ord }
   고정 항목은 다음 달에 지난달 금액으로 「예상」이 미리 나옴 → 그대로 확정하거나 숫자를 바꿔 확정
   수익 = 청구 합계 − 송금·토스 − 지출 (관리표 맨 아래 「수익금액」과 같은 계산) · 수익률 = 수익 ÷ 청구 합계
   관리표 가져오기 때 아래 비용표(임대료·인건비·보험…)를 그 달 「고정」으로 넣음 */
var LCOST = {};
function lgCostListen(){ db.ref('settlement/ledgerCost').on('value', function(s){ LCOST = s.val() || {}; if (document.getElementById('lgCostOv')) lgCostDraw(); if ($('tabLedger') && !$('tabLedger').classList.contains('hide') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tabLedger input, #lgCostOv input'))) renderLedger(); }); }
/* 계정과목(지출 코드) — 일반 기업 판매비와관리비·영업외비용 기준 (대표님 2026-10-05: 고정/일시 대신 지출 코드로 묶기) */
var LG_ACCT = [
  ['801', '임원급여'], ['802', '직원급여'], ['805', '잡급(아르바이트)'], ['806', '퇴직급여'], ['811', '복리후생비'], ['812', '여비교통비'], ['813', '접대비'],
  ['814', '통신비'], ['815', '수도광열비'], ['817', '세금과공과'], ['818', '감가상각비'], ['819', '임차료'], ['820', '수선비'], ['821', '보험료'], ['822', '차량유지비'],
  ['824', '운반비'], ['826', '도서인쇄비'], ['830', '소모품비'], ['831', '지급수수료'], ['833', '광고선전비'], ['837', '건물관리비'], ['840', '외주용역비'],
  ['931', '이자비용'], ['999', '기타 (분류 필요)']
];
var LG_ACCT_NAME = {}; LG_ACCT.forEach(function(a){ LG_ACCT_NAME[a[0]] = a[1]; });
/* 항목 이름 → 계정과목 추정 (사용자가 바꾼 게 우선) */
function lgAcctGuess(n){
  var s = String(n || '').replace(/\s/g, '');
  var R = [[/^대표|임원/, '801'], [/알바|아르바이트|일용/, '805'], [/퇴직/, '806'], [/인건비|급여|월급|상여/, '802'], [/식대|식비|복리|간식|회식/, '811'], [/출장|교통|주차/, '812'], [/접대|경조/, '813'],
    [/인터넷|케이티|^kt|통신|휴대폰|전화|lg유플|sk브로드/i, '814'], [/전기|관리비|수도|가스|난방/, '815'], [/세금|공과|재산세|면허/, '817'], [/수리|수선|보수/, '820'], [/보험/, '821'],
    [/차량|주유|유류|하이패스|렌탈차|리스차/, '822'], [/파렛트|팔레트|임대료|임차|월세|렌탈|리스/, '819'], [/운반|택배|퀵|화물|운송/, '824'], [/인쇄|도서/, '826'], [/소모품|비품|사무용품|박스구매|테이프/, '830'],
    [/광고|홍보|마케팅/, '833'], [/청소|경비|방역/, '837'], [/도급|용역|외주/, '840'], [/이자/, '931'], [/세무|기장|노무|수수료|운용|컨설팅|법무/, '831']];
  for (var i = 0; i < R.length; i++) if (R[i][0].test(s)) return R[i][1];
  return '999';
}
function lgCosts(ym){
  var cur = LCOST[ym] || {}, rows = Object.keys(cur).map(function(id){ var c = cur[id]; return { id: id, kind: c.kind || '고정', name: c.name || '', amount: +c.amount || 0, ok: !!c.ok, ord: c.ord || 0, acct: c.acct || null, skip: !!c.skip }; });
  /* 지난달(기록 있는 가장 가까운 달) 고정 항목 중 이번 달에 없는 것 = 예상 */
  var have = {}, xl = false; rows.forEach(function(r){ have[r.name] = 1; if (cur[r.id] && cur[r.id].xl) xl = true; });
  rows = rows.filter(function(r){ return !r.skip; });   /* 그만둔 고정 항목(빼기) */
  var p = ym; for (var i = 0; i < 12; i++){ p = lgPrev(p); if (LCOST[p] && Object.keys(LCOST[p]).length) break; }
  var prev = LCOST[p] || {};
  if (!xl) Object.keys(prev).forEach(function(id){ var c = prev[id]; if ((c.kind || '고정') !== '고정' || have[c.name] || c.skip) return;
    rows.push({ id: null, kind: '고정', name: c.name || '', amount: +c.amount || 0, ok: false, est: true, ord: c.ord || 0, acct: c.acct || null, from: p }); });
  rows.forEach(function(r){ r.ac = r.acct || lgAcctGuess(r.name); r.guess = !r.acct; });
  var ai = {}; LG_ACCT.forEach(function(a, k){ ai[a[0]] = k; });
  rows.sort(function(a, b){ return (ai[a.ac] - ai[b.ac]) || (a.ord || 0) - (b.ord || 0) || a.name.localeCompare(b.name, 'ko'); });
  var total = 0, est = 0, nEst = 0; rows.forEach(function(r){ total += r.amount; if (!r.ok){ est += r.amount; nEst++; } });
  return { rows: rows, total: total, est: est, nEst: nEst };
}
function lgCostSave(ym, row, patch){   /* 예상 줄을 고치거나 확정하면 그 달 기록으로 만듦 */
  if (row.id) return db.ref('settlement/ledgerCost/' + ym + '/' + row.id).update(patch || {});
  return db.ref('settlement/ledgerCost/' + ym).push(Object.assign({ kind: row.kind, name: row.name, amount: row.amount, ok: !!row.ok, ord: row.ord || 0, acct: row.acct || null }, patch || {}));
}
function lgCostOpen(){ var ov = document.getElementById('lgCostOv'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'lgCostOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;justify-content:flex-end';
  ov.innerHTML = '<div class="card" id="lgCostBox" style="width:min(640px,100%);height:100%;margin:0;border-radius:0;overflow:auto"></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov); lgCostDraw(); }
function lgCostDraw(){
  var box = document.getElementById('lgCostBox'); if (!box) return;
  var ym = lgYM(), C = lgCosts(ym); window._lgCost = C.rows;
  var acSel = function(i, cur){ return '<select class="tsel" style="font-size:11.5px;padding:.1rem .25rem;max-width:130px" onchange="lgCostEdit(' + i + ',{acct:this.value})">' + LG_ACCT.map(function(a){ return '<option value="' + a[0] + '"' + (a[0] === cur ? ' selected' : '') + '>' + a[0] + ' ' + a[1] + '</option>'; }).join('') + '</select>'; };
  var rowH = function(r, i, first, lastIn){
    return '<tr' + (r.ok ? '' : ' style="background:rgba(251,191,36,.06)"') + '>'
      + '<td style="white-space:nowrap"><button class="btn" style="padding:0 .3rem;font-size:11px" ' + (first ? 'disabled' : '') + ' onclick="lgCostMove(' + i + ',-1)" title="위로">▲</button><button class="btn" style="padding:0 .3rem;font-size:11px" ' + (lastIn ? 'disabled' : '') + ' onclick="lgCostMove(' + i + ',1)" title="아래로">▼</button></td>'
      + '<td><input type="text" class="famt" style="width:140px" value="' + esc(r.name) + '" onchange="lgCostEdit(' + i + ',{name:this.value.trim()})"></td>'
      + '<td class="n"><input type="number" class="famt" style="width:115px;text-align:right" value="' + (r.amount || '') + '" onchange="lgCostEdit(' + i + ',{amount:+this.value||0, ok:false})"></td>'
      + '<td>' + acSel(i, r.ac) + (r.guess ? '<div class="sm dim">자동 분류</div>' : '') + '</td>'
      + '<td><select class="tsel" style="font-size:11.5px;padding:.1rem .25rem" onchange="lgCostEdit(' + i + ',{kind:this.value})" title="고정 = 다음 달에 예상으로 넘어감 · 일시 = 이번 달만">' + ['고정', '일시'].map(function(k){ return '<option' + (k === r.kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></td>'
      + '<td style="white-space:nowrap">' + (r.ok ? '<b style="color:var(--g)">✔ 확정</b>' : '<button class="btn p" style="padding:.1rem .5rem;font-size:12px" onclick="lgCostEdit(' + i + ',{ok:true})">확정</button>' + (r.est ? '<div class="sm dim">' + esc(r.from) + ' 금액 예상</div>' : '<div class="sm" style="color:#fbbf24">예상</div>')) + '</td>'
      + '<td><button class="btn r" style="padding:.05rem .4rem" title="' + (r.id ? '지우기' : '이번 달부터 이 고정 항목 빼기') + '" onclick="lgCostDel(' + i + ')">×</button></td></tr>'; };
  var groups = []; C.rows.forEach(function(r, i){ var g = groups[groups.length - 1]; if (!g || g.ac !== r.ac){ g = { ac: r.ac, list: [] }; groups.push(g); } g.list.push([r, i]); });
  var body = groups.map(function(g){ var t = g.list.reduce(function(s, x){ return s + x[0].amount; }, 0);
    return '<tr><td colspan="7" style="background:var(--s2);padding:.35rem .5rem"><b>' + g.ac + ' ' + esc(LG_ACCT_NAME[g.ac] || g.ac) + '</b> <span class="sm dim">' + g.list.length + '개</span><span style="float:right;font-weight:800">₩' + won0(t) + (C.total ? ' <span class="sm dim">(' + (t / C.total * 100).toFixed(1) + '%)</span>' : '') + '</span></td></tr>'
      + g.list.map(function(x, k){ return rowH(x[0], x[1], k === 0, k === g.list.length - 1); }).join(''); }).join('');
  box.innerHTML = '<div class="card-h"><span class="card-t">💸 ' + esc(ymLabel(ym)) + ' 지출 (계정과목별)</span><button class="btn" style="margin-left:auto" onclick="document.getElementById(\'lgCostOv\').remove()">닫기</button></div>'
    + '<div style="font-size:15px;margin:.2rem 0 .4rem">지출 합계 <b>₩' + won0(C.total) + '</b>' + (C.nEst ? ' <span class="sm" style="color:#fbbf24">(예상 ' + C.nEst + '개 ₩' + won0(C.est) + ' 포함)</span>' : ' <span class="sm" style="color:var(--g)">모두 확정</span>') + '</div>'
    + '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.5rem"><button class="btn" onclick="lgCostAdd()">＋ 지출 추가</button>' + (C.nEst ? '<button class="btn p" onclick="lgCostAllOk()">예상 ' + C.nEst + '개 모두 확정</button>' : '')
    + (C.rows.some(function(r){ return r.guess && r.id; }) ? '<button class="btn" onclick="lgCostFixGuess()" title="자동 분류를 이 달 기록에 저장 — 다음 달에도 그 계정으로">자동 분류 저장</button>' : '') + '</div>'
    + '<table class="ftbl" style="min-width:0"><tbody>' + body + '</tbody></table>'
    + '<div class="sec-note" style="margin-top:.8rem">· 계정과목 = 일반 기업 지출 코드(판매비와관리비 8xx · 이자비용 931) — 줄마다 바꿀 수 있고, 처음엔 항목 이름으로 자동 분류<br>· ▲▼ = 같은 계정 안에서 순서 · 고정 = 다음 달에 이번 금액으로 「예상」, 그대로 확정하거나 고쳐 확정 · 일시 = 이번 달만<br>· 수익 = 청구 합계 − 송금·토스 − 지출 (삼자물류정산관리 위 카드)</div>';
}
function lgCostEdit(i, patch){ var r = (window._lgCost || [])[i]; if (!r) return; if (patch.acct === undefined && !r.acct && r.guess) patch.acct = r.ac; lgCostSave(lgYM(), r, patch); }
function lgCostMove(i, d){   /* 같은 계정 안에서 위·아래 — 그 계정 줄들 순서를 다시 매김 */
  var L = window._lgCost || [], r = L[i]; if (!r) return; var same = L.filter(function(x){ return x.ac === r.ac; }), k = same.indexOf(r), j = k + d; if (j < 0 || j >= same.length) return;
  var t = same[k]; same[k] = same[j]; same[j] = t;
  var ym = lgYM(), u = {}, P = [];
  same.forEach(function(x, n){ var ord = (n + 1) * 10; if (x.id){ u[ym + '/' + x.id + '/ord'] = ord; if (!x.acct) u[ym + '/' + x.id + '/acct'] = x.ac; }
    else { var key = db.ref('settlement/ledgerCost/' + ym).push().key; u[ym + '/' + key] = { kind: x.kind, name: x.name, amount: x.amount, ok: false, ord: ord, acct: x.ac }; } });
  db.ref('settlement/ledgerCost').update(u);
}
function lgCostDel(i){ var r = (window._lgCost || [])[i]; if (!r) return;
  if (!r.id){ if (confirm('「' + r.name + '」 고정 항목을 이번 달부터 뺄까요? (다음 달에도 안 나옴)')) db.ref('settlement/ledgerCost/' + lgYM()).push({ kind: '고정', name: r.name, amount: 0, ok: true, skip: true, acct: r.ac }); return; }
  if (confirm('「' + r.name + '」 지출을 지울까요?')) db.ref('settlement/ledgerCost/' + lgYM() + '/' + r.id).set(null); }
function lgCostAdd(){ var n = prompt('지출 항목 이름 (예: 임대료, 급여, 기업카드, 퀵비)', ''); if (!n || !n.trim()) return; var a = prompt('금액', ''); if (a == null) return;
  var k = confirm('매달 나가는 고정 지출인가요?\n\n확인 = 고정 (다음 달에 예상으로 넘어감)\n취소 = 일시 (이번 달만)') ? '고정' : '일시';
  db.ref('settlement/ledgerCost/' + lgYM()).push({ kind: k, name: n.trim(), amount: +String(a).replace(/[^\d.-]/g, '') || 0, ok: false, ord: 9990, acct: lgAcctGuess(n) }); }
function lgCostAllOk(){ var ym = lgYM(), u = {}; (window._lgCost || []).forEach(function(r){ if (r.ok) return; if (r.id) u[ym + '/' + r.id + '/ok'] = true; else { var k = db.ref('settlement/ledgerCost/' + ym).push().key; u[ym + '/' + k] = { kind: r.kind, name: r.name, amount: r.amount, ok: true, ord: r.ord || 0, acct: r.ac }; } });
  db.ref('settlement/ledgerCost').update(u); }
function lgCostFixGuess(){ var ym = lgYM(), u = {}; (window._lgCost || []).forEach(function(r){ if (r.id && !r.acct) u[ym + '/' + r.id + '/acct'] = r.ac; }); db.ref('settlement/ledgerCost').update(u).then(function(){ toast('계정과목 저장'); }); }
