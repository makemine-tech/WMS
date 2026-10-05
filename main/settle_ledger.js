/* ============================================================
   정산관리 — 🗂️ 삼자물류정산관리 (대표님 2026-10-05 · 00_삼자물류정산관리_MM월.xlsx 를 웹으로)
   정산월마다 업체 한 줄: 관리업체 · 업체명 · 정산서전달메일 · 전미수금액 · 정산금액(✅ 완료 확정본 합계) · 입금액
                         · 1.정산서전달 · 2.계산서발행 · 3.체크완료 · 4.업체송금(입금) · 미수 · 메모
     + 확정 거래내역서 내려받기: 원본 양식 / 디자인 1·2·3 (settle_design.js)
     + 업체 정보(세금계산서용): 사업자번호 · 상호 · 성명 · 주소 · 업태 · 종목 · 이메일1·2 — 한 번 넣으면 다음 달에도
     + 기타 거래처 줄(외부·자체 비용 등 정산관리 엑셀의 나머지 줄)
     + 엑셀에서 가져오기(그 달 시트 「YY_MM월정산분」) · 엑셀로 내보내기(원래 관리표 열 그대로 — 세금계산서 등록 칸 포함)
   DB: settlement/ledger/{ym}/{업체키} = { sent, inv, chk, paid, paidAmt(입금액), send(송금·토스 = 보낼 돈), carry, memo }
       settlement/ledgerInfo/{업체키} = { group, mail, biz, corp, ceo, addr, btype, bitem, mail1, mail2 }
       settlement/ledgerExtra/{ym}/{id} = { group, name, mail, amount, sent, inv, chk, paid, paidAmt, carry, memo }
   전미수 = 지난달 미수 (지난달 전미수 + 정산금액 − 입금액, 「입금」만 체크하고 입금액이 비면 전액 입금) — 직접 넣으면(carry) 그 값
   쓰는 전역: db, YM, ALLBOX, VENDORS, monthVendors, doneOf, vKey, decryptBox, esc, toast, ymLabel, me, firebase, XLSX, SETTLE_DESIGN
============================================================ */
var LEDGER = {}, LINFO = {}, LEXTRA = {}, LG_OPT = (function(){ try { return JSON.parse(localStorage.getItem('ledgerOpt')) || { design: 'd1', hideZero: true }; } catch (e) { return { design: 'd1', hideZero: true }; } })();
function ledgerListen(){
  var re = function(){ if ($('tabLedger') && !$('tabLedger').classList.contains('hide') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#tabLedger input[type=text], #tabLedger input[type=number], #tabLedger textarea'))) renderLedger(); };
  db.ref('settlement/ledger').on('value', function(s){ LEDGER = s.val() || {}; re(); });
  db.ref('settlement/ledgerInfo').on('value', function(s){ LINFO = s.val() || {}; re(); });
  db.ref('settlement/ledgerExtra').on('value', function(s){ LEXTRA = s.val() || {}; re(); });
  var ym = $('ym'); if (ym) ym.addEventListener('change', function(){ setTimeout(re, 50); });
}
function lgPrev(ym){ var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1; if (!m){ m = 12; y--; } return y + '-' + String(m).padStart(2, '0'); }
function lgAmt(vk, ym){ var d = doneOf(vk, ym); return d && d.total != null ? +d.total : null; }
/* 미수 = 전미수 + 정산금액 − 입금액 */
function lgState(kind, key, ym, depth){
  var rec = kind === 'v' ? ((LEDGER[ym] || {})[key] || {}) : ((LEXTRA[ym] || {})[key] || {});
  var amt = kind === 'v' ? lgAmt(key, ym) : (rec.amount != null && rec.amount !== '' ? +rec.amount : null);
  var carry = rec.carry != null && rec.carry !== '' ? +rec.carry : (depth > 12 || kind !== 'v' ? 0 : lgState('v', key, lgPrev(ym), (depth || 0) + 1).unpaid);
  var due = (carry || 0) + (amt || 0);
  var paid = rec.paidAmt != null && rec.paidAmt !== '' ? +rec.paidAmt : (rec.paid ? due : 0);
  return { rec: rec, amt: amt, carry: carry || 0, paid: paid, unpaid: Math.round(due - paid) };
}
function lgSet(path, v){ return db.ref('settlement/' + path).set(v === '' || v == null || v === false ? null : v).catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); }); }
function lgOpt(k, v){ LG_OPT[k] = v; try { localStorage.setItem('ledgerOpt', JSON.stringify(LG_OPT)); } catch (e) {} }
var won0 = function(n){ return n == null || n === '' ? '' : Math.round(+n).toLocaleString('ko-KR'); };

function renderLedger(){
  var el = $('tabLedger'); if (!el) return;
  if (!YM){ el.innerHTML = ''; return; }
  var V = monthVendors(YM), X = LEXTRA[YM] || {};
  var rows = V.map(function(v){ var s = lgState('v', v.vk, YM, 0), I = LINFO[v.vk] || {}; return { kind: 'v', key: v.vk, name: v.name, skip: v.skip, done: v.done, I: I, s: s, group: I.group || '' }; })
    .concat(Object.keys(X).map(function(id){ var s = lgState('x', id, YM, 0); return { kind: 'x', key: id, name: X[id].name || '(이름 없음)', I: X[id], s: s, group: X[id].group || '' }; }));
  rows.sort(function(a, b){ return (a.kind === b.kind ? 0 : a.kind === 'v' ? -1 : 1) || String(a.group).localeCompare(String(b.group), 'ko') || a.name.localeCompare(b.name, 'ko'); });
  var act = rows.filter(function(r){ return !r.skip && (r.s.amt || r.s.carry || r.s.rec.send); });
  var S = { amt: 0, paid: 0, unpaid: 0, send: 0, n: act.length, sent: 0, inv: 0, chk: 0, pd: 0 };
  act.forEach(function(r){ S.amt += r.s.amt || 0; S.paid += r.s.paid || 0; S.send += +r.s.rec.send || 0; S.unpaid += r.s.unpaid > 0 ? r.s.unpaid : 0; ['sent', 'inv', 'chk'].forEach(function(k){ if (r.s.rec[k]) S[k]++; }); if (r.s.rec.paid) S.pd++; });
  var card = function(t, v, s, c){ return '<div style="flex:1;min-width:150px;background:var(--s2);border:1px solid var(--br);border-radius:12px;padding:.7rem .9rem"><div class="sm dim">' + t + '</div><div style="font-size:20px;font-weight:800;margin-top:.15rem' + (c ? ';color:' + c : '') + '">' + v + '</div>' + (s ? '<div class="sm dim">' + s + '</div>' : '') + '</div>'; };
  var dsel = '<select class="tsel" onchange="lgOpt(\'design\', this.value)">' + [{ id: 'orig', name: '원본 양식' }].concat(SETTLE_DESIGN.list).map(function(d){ return '<option value="' + d.id + '"' + (LG_OPT.design === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>';
  var h = '<div class="bar"><span class="bar-t">' + esc(ymLabel(YM)) + ' 삼자물류정산관리</span><span class="sec-note">정산월은 파일함 탭에서 바꿉니다 · 정산금액 = 업체 ✅ 완료 확정본 합계</span><span class="sp"></span>'
    + '<label class="btn" style="cursor:pointer">📥 관리표 엑셀에서 가져오기<input type="file" accept=".xlsx,.xls" style="display:none" onchange="lgImport(this)"></label>'
    + '<button class="btn" onclick="lgExport()">📤 관리표 엑셀로 내보내기</button><button class="btn" onclick="lgAddExtra()">＋ 기타 거래처</button></div>'
    + '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin:.2rem 0 1rem">'
    + card('정산 업체', S.n + '곳', '이번 달 금액이 있는 곳') + card('청구 합계 (VAT 포함)', '₩' + won0(S.amt), '공급가 ₩' + won0(S.amt / 1.1))
    + card('송금·토스 (보낼 돈)', '₩' + won0(S.send), '관리표 송금토스금액') + card('입금 확인', '₩' + won0(S.paid), S.pd + ' / ' + S.n + '곳', 'var(--g)') + card('미수 합계', '₩' + won0(S.unpaid), '전미수 포함', S.unpaid ? '#f87171' : 'var(--g)')
    + card('진행', '전달 ' + S.sent + ' · 계산서 ' + S.inv, '체크 ' + S.chk + ' · 입금 ' + S.pd + ' / ' + S.n) + '</div>'
    + '<div class="card"><div class="card-h"><span class="card-t">업체별 정산 진행</span><span class="card-s">체크·입력하면 바로 저장 · 거래내역서는 ✅ 완료 확정된 업체만 · 내려받기 모양 ' + dsel
    + ' <label class="sm" style="margin-left:.4rem"><input type="checkbox" ' + (LG_OPT.hideZero ? 'checked' : '') + ' onchange="lgOpt(\'hideZero\', this.checked)"> 0원 줄 숨기기(디자인)</label></span></div>'
    + '<div style="overflow-x:auto"><table class="ftbl lgt"><thead><tr><th>관리업체</th><th>업체명</th><th>정산서전달메일</th><th class="n">전미수</th><th class="n">정산금액</th><th class="n">송금·토스</th><th class="n">입금액</th>'
    + '<th>1.전달</th><th>2.계산서</th><th>3.체크</th><th>4.입금</th><th class="n">미수</th><th>거래내역서</th><th>메모</th><th></th></tr></thead><tbody>';
  var P = function(r, k){ return (r.kind === 'v' ? 'ledger/' + YM + '/' + r.key : 'ledgerExtra/' + YM + '/' + r.key) + '/' + k; };
  rows.forEach(function(r){
    var s = r.s, rec = s.rec, I = r.I || {}, mail = r.kind === 'v' ? (I.mail || '') : (rec.mail || '');
    var ck = function(k){ return '<td style="text-align:center"><input type="checkbox" ' + (rec[k] ? 'checked' : '') + ' onchange="lgSet(\'' + P(r, k) + '\', this.checked)"></td>'; };
    var num = function(k, v, ph){ return '<input type="number" class="famt" style="width:110px" value="' + (v != null && v !== '' ? v : '') + '" placeholder="' + (ph || '') + '" onchange="lgSet(\'' + P(r, k) + '\', this.value === \'\' ? null : +this.value)">'; };
    var dl = r.kind === 'v' && r.done ? '<button class="btn p" style="padding:.15rem .6rem" onclick="lgDownload(\'' + esc(r.key) + '\')">📄 내려받기</button>' : r.kind === 'v' ? '<span class="sm dim">' + (r.skip ? '이번 달 없음' : '확정 전') + '</span>' : '';
    var amtCell = r.kind === 'v' ? '<b>' + won0(s.amt) + '</b>' : num('amount', rec.amount, '금액');
    h += '<tr' + (r.skip ? ' style="opacity:.45"' : '') + '><td><input type="text" class="famt" style="width:90px" value="' + esc(r.group) + '" onchange="lgSet(\'' + (r.kind === 'v' ? 'ledgerInfo/' + r.key + '/group' : P(r, 'group')) + '\', this.value.trim())"></td>'
      + '<td style="min-width:210px"><b>' + esc(r.name) + '</b>' + (r.kind === 'v' ? ' <a href="javascript:void 0" class="sm" title="세금계산서용 업체 정보" onclick="lgInfo(\'' + esc(r.key) + '\')">⚙ 정보' + (I.biz ? '' : ' <span style="color:#fbbf24">(없음)</span>') + '</a>' : '') + '</td>'
      + '<td><input type="text" class="famt" style="width:170px" value="' + esc(mail) + '" onchange="lgSet(\'' + (r.kind === 'v' ? 'ledgerInfo/' + r.key + '/mail' : P(r, 'mail')) + '\', this.value.trim())"></td>'
      + '<td class="n">' + num('carry', rec.carry, won0(s.carry)) + '</td><td class="n">' + amtCell + '</td><td class="n">' + num('send', rec.send, '보낼 돈') + '</td><td class="n">' + num('paidAmt', rec.paidAmt, rec.paid ? won0(s.carry + (s.amt || 0)) : '') + '</td>'
      + ck('sent') + ck('inv') + ck('chk') + ck('paid')
      + '<td class="n"><b style="color:' + (s.unpaid > 0 ? '#f87171' : s.unpaid < 0 ? '#60a5fa' : 'var(--g)') + '">' + (s.unpaid ? won0(s.unpaid) + (s.unpaid < 0 ? ' (초과)' : '') : (s.amt || s.carry ? '완료' : '')) + '</b></td>'
      + '<td>' + dl + '</td><td><input type="text" class="famt" style="width:160px" value="' + esc(rec.memo || '') + '" onchange="lgSet(\'' + P(r, 'memo') + '\', this.value.trim())"></td>'
      + '<td>' + (r.kind === 'x' ? '<button class="btn r" style="padding:.1rem .45rem" onclick="lgDelExtra(\'' + r.key + '\')">×</button>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div></div>'
    + '<div class="sec-note" style="margin-top:.6rem">· 정산금액은 업체 정산 탭 ⑤ 완료 확정 때 올린 확정본 합계 · 전미수는 지난달 미수가 자동으로 넘어옴(칸에 직접 넣으면 그 값) · 「4.입금」만 체크하고 입금액이 비면 전액 입금<br>'
    + '· 내려받기: 원본 양식 = 확정본 그대로 · 디자인 = 맨 앞에 디자인한 「거래명세서」 시트 + 데이터 시트 그대로(원본 거래명세표는 숨김 시트로 남아 수량·금액이 그 칸을 가리킴)</div>';
  el.innerHTML = h;
}
function lgFinal(vk){ var d = doneOf(vk, YM); if (!d || !d.id) return null; var m = (ALLBOX[YM] || {})[d.id]; return m ? { m: m, d: d } : null; }
function lgDownload(vk){
  var F = lgFinal(vk); if (!F){ toast('확정본 파일을 못 찾았습니다'); return; }
  var name = F.m.name, des = LG_OPT.design || 'orig', V = monthVendors(YM).filter(function(v){ return v.vk === vk; })[0] || { name: vk }, I = LINFO[vk] || {};
  var save = function(buf, fn){ var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  toast('확정본 여는 중…');
  decryptBox(F.m).then(function(bytes){
    if (des === 'orig'){ save(bytes, name); toast('📄 원본 양식 내려받음'); return; }
    var D = SETTLE_DESIGN.list.filter(function(x){ return x.id === des; })[0];
    return SETTLE_DESIGN.build(bytes, des, { vendor: V.name, corp: I.corp || V.name.replace(/\(.*\)$/, ''), ym: YM, mail: I.mail1 || I.mail || '', hideZero: !!LG_OPT.hideZero }).then(function(R){
      save(R.buf, name.replace(/\.(xlsx|xls)$/i, '') + '_' + (D ? D.name.split(' · ')[0].replace(/\s/g, '') : des) + '.xlsx');
      toast('📄 ' + (D ? D.name : des) + ' 내려받음' + (R.warn.length ? ' — ' + R.warn.join(' / ') : ''));
    });
  }).catch(function(e){ alert('내려받기 실패: ' + ((e && (e.code || e.message)) || e)); console.error(e); });
}
function lgInfo(vk){
  var I = LINFO[vk] || {}, ov = document.getElementById('lgOv'); if (ov) ov.remove();
  var F = [['biz', '사업자번호'], ['corp', '공급받는자 상호'], ['ceo', '공급받는자 성명'], ['addr', '사업장 주소'], ['btype', '업태'], ['bitem', '종목'], ['mail1', '이메일1 (계산서)'], ['mail2', '이메일2']];
  ov = document.createElement('div'); ov.id = 'lgOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:60px 16px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:560px;width:100%;margin:0"><div class="card-h"><span class="card-t">⚙ ' + esc(vk) + ' — 세금계산서용 정보</span><button class="btn" style="margin-left:auto" onclick="document.getElementById(\'lgOv\').remove()">닫기</button></div>'
    + F.map(function(f){ return '<div style="display:flex;gap:.6rem;align-items:center;margin:.35rem 0"><span class="sm" style="width:120px">' + f[1] + '</span><input type="text" class="famt" style="flex:1" value="' + esc(I[f[0]] || '') + '" onchange="lgSet(\'ledgerInfo/' + esc(vk) + '/' + f[0] + '\', this.value.trim())"></div>'; }).join('')
    + '<div class="sm dim" style="margin-top:.5rem">고치면 바로 저장 · 다음 달에도 그대로 · 디자인 거래명세서의 공급받는자 상호로도 씀</div></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
}
function lgAddExtra(){ var n = prompt('기타 거래처 이름 (예: (주)영우컴퍼니, 알바도급비, 운송비)', ''); if (!n || !n.trim()) return; db.ref('settlement/ledgerExtra/' + YM).push({ name: n.trim(), at: firebase.database.ServerValue.TIMESTAMP }); }
function lgDelExtra(id){ var x = (LEXTRA[YM] || {})[id]; if (!x || !confirm('「' + (x.name || '') + '」 줄을 지울까요?')) return; db.ref('settlement/ledgerExtra/' + YM + '/' + id).set(null); }

/* ── 엑셀에서 가져오기: 그 달 시트(26_08월정산분) — 업체 줄은 업체에, 안 맞는 줄은 기타 거래처로 ── */
function lgNorm(s){ return String(s || '').replace(/㈜|\(주\)|주식회사|\s/g, ''); }
/* 관리표 업체명 → 업체: ① 정산금액이 그 달 확정본 합계와 같은 업체(±1원) ② 이름 — 아직 안 쓴 업체만, 괄호(구분)가 한쪽에만 있으면 안 맞는 걸로
   (관리표 이름은 법인명이라 정산서 이름과 다름: 씨엘에프 = 포인트나인크루 본 정산, 포인트나인크루 = 용차비 → 금액이 더 확실) */
function lgMatch(name, amt, V, used, amtOf){
  if (amt > 0){ var hit = V.filter(function(v){ var a = amtOf(v); return !used[v.vk] && a != null && Math.abs(a - amt) <= 1; }); if (hit.length === 1) return hit[0]; }
  var n = lgNorm(name), core = n.replace(/\(.*\)/, ''), par = (n.match(/\(([^)]*)\)/) || [])[1] || '', best = null, bs = 0, cands = [];
  V.forEach(function(v){ if (used[v.vk]) return; var m = lgNorm(v.name), mc = m.replace(/\(.*\)/, ''), mp = (m.match(/\(([^)]*)\)/) || [])[1] || '', s = 0;
    if (m === n) s = 10; else if (mc && core && (mc.indexOf(core) >= 0 || core.indexOf(mc) >= 0 || window.vendorMatcher(v.name)(name))){
      if (par && mp){ var common = par.split('').filter(function(ch){ return mp.indexOf(ch) >= 0; }).length; s = common >= 2 ? 6 + common / 10 : 0; }
      else s = par ? 0 : 3; }
    if (s >= 3) cands.push(v);
    if (s > bs){ bs = s; best = v; } });
  /* 같은 이름 정산서가 여러 개고(탑프레쉬 당월분 + 7월 미청구분) 그 합이 정산금액이면 → 전부 이 줄 */
  if (amt > 0 && cands.length > 1){ var sum = cands.reduce(function(t, v){ return t + (amtOf(v) || 0); }, 0); if (Math.abs(sum - amt) <= 2) return cands; }
  return bs >= 3 ? best : null;
}
function lgImport(input){
  var f = input.files[0]; input.value = ''; if (!f) return;
  var sn = YM.slice(2, 4) + '_' + YM.slice(5, 7) + '월정산분';
  f.arrayBuffer().then(function(b){
    var wb = XLSX.read(b, { type: 'array' }), ws = wb.Sheets[sn];
    if (!ws){ alert('「' + sn + '」 시트가 없습니다 (있는 시트: ' + wb.SheetNames.slice(0, 6).join(', ') + ' …)'); return; }
    var a = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }), hi = a.findIndex(function(r){ return String(r[1]).replace(/\s/g, '') === '업체명'; });
    if (hi < 0){ alert('제목줄(업체명)을 못 찾았습니다'); return; }
    var V = monthVendors(YM), used = {}, up = {}, nV = 0, nX = 0, group = '', o = function(v){ return String(v).trim().toLowerCase() === 'o'; };
    for (var i = hi + 1; i < a.length; i++){ var r = a[i], nm = String(r[1] || '').trim(); if (String(r[0]).trim()) group = String(r[0]).trim(); if (!nm) continue;   /* 합계 줄·아래 비용 표는 업체명 칸이 비어 있음 */
      var st = { sent: o(r[6]) || null, inv: o(r[7]) || null, chk: o(r[8]) || null, paid: o(r[9]) || null, carry: typeof r[3] === 'number' && r[3] ? r[3] : null,
        send: typeof r[5] === 'number' && r[5] ? r[5] : null,   /* F 송금토스금액 = 우리가 보내는 돈 (알바도급비·운송비·씨엘에프 등) */ memo: typeof r[5] === 'string' && r[5].trim() ? r[5].trim() : (typeof r[10] === 'number' ? '관리표 합계칸 ' + r[10] : null) };
      var info = { group: group || null, mail: String(r[2] || '').trim() || null, biz: String(r[12] || '').trim() || null, corp: String(r[14] || '').trim() || null, ceo: String(r[15] || '').trim() || null, addr: String(r[16] || '').trim() || null,
        btype: String(r[17] || '').trim() || null, bitem: String(r[18] || '').trim() || null, mail1: String(r[19] || '').trim() || null, mail2: String(r[20] || '').trim() || null };
      var hit = lgMatch(nm, typeof r[4] === 'number' ? r[4] : 0, V, used, function(x){ return lgAmt(x.vk, YM); }), L = hit ? [].concat(hit) : [];
      L.forEach(function(v){ used[v.vk] = 1; nV++; Object.keys(st).forEach(function(k){ up['ledger/' + YM + '/' + v.vk + '/' + k] = st[k]; }); Object.keys(info).forEach(function(k){ if (info[k] != null) up['ledgerInfo/' + v.vk + '/' + k] = info[k]; }); });
      if (L.length){}
      else { nX++; var id = 'x' + Date.now().toString(36) + i; up['ledgerExtra/' + YM + '/' + id] = Object.assign({ name: nm, group: group || null, mail: info.mail, amount: typeof r[4] === 'number' ? r[4] : null }, st); }
    }
    if (!confirm('「' + sn + '」에서 업체 ' + nV + '줄 · 기타 거래처 ' + nX + '줄을 가져옵니다.\n\n같은 달에 이미 넣은 체크·입금·메모는 엑셀 값으로 바뀝니다. 계속할까요?')) return;
    return db.ref('settlement').update(up).then(function(){ toast('📥 가져옴 — 업체 ' + nV + ' · 기타 ' + nX); });
  }).catch(function(e){ alert('가져오기 실패: ' + ((e && e.message) || e)); });
}
/* ── 엑셀로 내보내기: 원래 관리표 열 그대로 ── */
function lgExport(){
  var H = ['관리업체', '업체명', '정산서전달메일', '전미수금액', '정산금액', '송금토스금액', '1.정산서전달', '2.계산서발행', '3.체크완료', '4.업체송금', '미수', '', '사업자번호', '공급받는자 종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소', '공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2', '공급가액', '세액', '비고', '일자1 (2자리, 작성년월 제외)', '품목1', '규격1', '수량1', '단가1', '공급가액1', '세액1'];
  var aoa = [['입금  계좌: 기업은행  568-025968-04-010', '', '경기도 김포시 황금3로 7번길 42'], ['예  금  주: 메이크마인디자인㈜'], H], dd = new Date(Date.UTC(+YM.slice(0, 4), +YM.slice(5, 7), 0)).getUTCDate();
  var V = monthVendors(YM), X = LEXTRA[YM] || {}, oo = function(b){ return b ? 'o' : ''; };
  V.forEach(function(v){ var s = lgState('v', v.vk, YM, 0), I = LINFO[v.vk] || {}, rec = s.rec; if (v.skip && !s.amt) return; var sup = s.amt != null ? s.amt / 1.1 : '';
    aoa.push([I.group || '', v.name, I.mail || '', s.carry || '', s.amt != null ? s.amt : '', rec.send != null ? rec.send : (rec.memo || ''), oo(rec.sent), oo(rec.inv), oo(rec.chk), oo(rec.paid), s.unpaid || '', '',
      I.biz || '', '', I.corp || '', I.ceo || '', I.addr || '', I.btype || '', I.bitem || '', I.mail1 || '', I.mail2 || '', sup === '' ? '' : Math.round(sup), sup === '' ? '' : Math.round(s.amt - sup), '', dd, '포장재 외', '', '', '', sup === '' ? '' : Math.round(sup), sup === '' ? '' : Math.round(s.amt - sup)]); });
  Object.keys(X).forEach(function(id){ var s = lgState('x', id, YM, 0), x = X[id];
    aoa.push([x.group || '', x.name || '', x.mail || '', s.carry || '', x.amount != null ? x.amount : '', x.send != null ? x.send : (x.memo || ''), oo(x.sent), oo(x.inv), oo(x.chk), oo(x.paid), s.unpaid || '']); });
  var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = H.map(function(h, i){ return { wch: i === 1 ? 30 : i === 2 ? 28 : i === 16 ? 40 : 12 }; });
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, YM.slice(2, 4) + '_' + YM.slice(5, 7) + '월정산분');
  XLSX.writeFile(wb, '00_삼자물류정산관리_' + YM.slice(5, 7) + '월.xlsx');
}
