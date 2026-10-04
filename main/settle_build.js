/* ============================================================
   정산관리 — 이번 달 정산서 초안 엑셀 만들기 (settlement.html 업체 정산 탭)

   지난달 완료본(표본)을 틀로 열어(ExcelJS — 서식·수식 유지) 이번 달 것으로 바꿔 내려받는다.
     1) 거래명세표 날짜 → 이번 달 말일
     2) 데이터 시트
        · '원본 그대로'로 정한 시트 → 이번 달 파일함 원본으로 내용 교체 (제목줄 이름으로 열 맞춤)
        · 용차비 시트(화물 청구서 종류) → 화물 청구서 Sheet1 에서 이 업체 건만, 확인 화면에서 고친 금액으로
        시트를 바꾸면 그 시트를 참조하는 수량 수식(=반품비!G12 등)은 엑셀을 열 때 다시 계산된다
     3) 수량 칸
        · 📌 고정값 → 지난달 그대로   · ✏️ 매번 입력 → 화면에 넣은 이번 달 값
        · 피벗 수식(GETPIVOTDATA) → 피벗표가 따라오지 않아 지난달 값으로 두고 노란색 '확인 필요'
        · 룰 없는 직접 입력 칸 → 지난달 값, 노란색
     4) 맨 뒤 「점검」 시트 — 바꾼 것 / 확인할 것 목록
   업체별 자동 계산(엔진)이 붙으면 3)의 노란 칸이 계산값으로 바뀐다.

   이번 달 선택값: settlement/vendors/{업체키}/run/{ym} = { src:{시트키: 파일함id | '@freight:업체명'}, manual:{행: 값} }
   쓰는 전역: db, YM, BOX, FREIGHT, VW, VENDORS, esc, $, toast, getBytes, WMS2FA, ExcelJS, XLSX, sKey, frFinal, frBase
============================================================ */
var YEL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };

function lastDay(ym){ var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function txt0(v){ if (v && v.richText) return v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) return v.result == null ? '' : String(v.result); return v == null ? '' : String(v); }
function nsp(v){ return String(v == null ? '' : v).replace(/\s+/g, ''); }
function runOf(){ return ((((VENDORS[VW.vkey] || {}).run) || {})[YM]) || {}; }
function optOf(){ var e = engineOf(VW.vkey); return (e && e.opt) || {}; }   /* 업체 설정(settle_engines.js)의 옵션 */
function setOpt(k, v){ return db.ref('settlement/vendors/' + VW.vkey + '/opt/' + k).set(v ? true : null); }
/* 마지막으로 만든 엑셀에서 무엇이 적용·변경됐는지 (화면) */
function buildLogHtml(){
  var L = VW && VW._lastLog; if (!L) return '';
  var tag = { '확인 필요': 'warn', '특이사항': 'warn', '자동 적용': 'okk' }, isW = function(l){ return l[0] === '확인 필요' || l[0] === '특이사항'; };
  var W = L.log.filter(isW), O = L.log.filter(function(l){ return !isW(l); });
  /* 특이사항·확인 필요는 맨 위에 따로 — 애매하거나 놓칠 수 있는 곳 (대표님 2026-10-03) */
  var warn = W.length ? '<div style="border:1px solid #fbbf24;border-radius:10px;padding:.6rem .8rem;margin:.8rem 0 .4rem;background:rgba(251,191,36,.08)">'
    + '<div style="font-weight:800;color:#fbbf24;margin-bottom:.35rem">⚠️ 특이사항 · 확인 필요 ' + W.length + '건 — 엑셀 맨 뒤 「점검」 시트에 위치와 함께 있습니다</div>'
    + W.map(function(l){ return '<div class="sm" style="margin:.15rem 0">· <b>' + esc(l[0]) + '</b> ' + esc(l[1]) + '</div>'; }).join('') + '</div>'
    : '<div class="sm" style="color:var(--g);margin:.8rem 0 .3rem">✔ 특이사항 없음</div>';
  return warn + '<div class="sec-note" style="margin:.8rem 0 .3rem"><b>방금 만든 ' + esc(L.name) + '</b> 에 적용된 내용</div>'
    + '<table class="ftbl" style="min-width:0"><tbody>' + O.map(function(l){
      return '<tr><td style="white-space:nowrap">' + (tag[l[0]] ? '<span class="chk ' + tag[l[0]] + '">' + esc(l[0]) + '</span>' : '<span class="dim">' + esc(l[0]) + '</span>') + '</td><td>' + esc(l[1]) + '</td></tr>'; }).join('')
    + '</tbody></table>';
}
function setRun(path, val){ return db.ref('settlement/vendors/' + VW.vkey + '/run/' + YM + '/' + path).set(val == null || val === '' ? null : val); }

/* 화물 청구서에서 이 업체로 보이는 업체명 후보 (괄호 앞 이름이 업체 이름에 들어 있거나 반대) */
function freightVendors(){
  var names = {};
  frIds().forEach(function(fid){ var ch = (FREIGHT[YM][fid] || {}).chk || {}; ((FREIGHT[YM][fid] || {}).rows || []).forEach(function(r, i){ var b = frBase(frVendor(r, ch[i])); if (b) names[b] = (names[b] || 0) + 1; }); });
  return Object.keys(names).sort(function(a, b){ return names[b] - names[a]; });
}
function guessFreightVendor(){
  var vn = nsp(VW.name), list = freightVendors();
  for (var i = 0; i < list.length; i++){ var b = nsp(list[i]); if (b && (vn.indexOf(b) >= 0 || b.indexOf(vn.replace(/\(.*$/, '')) >= 0)) return list[i]; }
  return '';
}
/* ── 이 업체가 쓰는 파일 (대표님 2026-10-04) ──
   파일함 파일을 모든 업체가 다 열어 보지 않게, 업체마다 쓸 파일만 체크 → 초안은 체크한 파일만 열어서 만듦.
   체크는 settlement/vendors/{키}/files/{파일 이름 지문} = 1(씀)|0(안 씀) — 이름에서 날짜·숫자를 뺀 지문이라 다음 달 같은 이름 파일에 그대로.
   아직 정하지 않은 파일은 추천: 표본 데이터 시트가 쓰는 종류 중 공통 파일 · 이름에 업체 이름이 든 파일 · 그 종류가 한 개뿐인 파일 · 화물 청구서(화물 흔적) */
function typeInfo(k){ return (typeof typeOf === 'function' ? typeOf(k) : (window.SETTLE_TYPE && SETTLE_TYPE(k))) || { key: k, cat: 'vendor', label: k, icon: '📎' }; }
function fileSigKey(m){ return sKey(m.type + '~' + String(m.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/\d+\s*(년|월|일)/g, '').replace(/[\d\s_\-().,\[\]~]/g, '').toLowerCase()); }
function needTypes(){
  var t = {};
  ((VW.A && VW.A.sheets) || []).forEach(function(s){ if (s.kind) (KIND2BOX[s.kind.key] || []).forEach(function(k){ t[k] = 1; }); });
  if (t.ebut_shiplist) t.ebut_orders = 1;   /* 택배비 시트 = 이벗 주문목록으로 제주 추가운임·판매처 판별 */
  var e = engineOf(VW.vkey); ((e && e.needs) || []).forEach(function(k){ t[k] = 1; });
  t.freight = 1;                            /* 화물 흔적은 모든 업체 */
  return t;
}
function fileUse(){
  var P = (VENDORS[VW.vkey] || {}).files || {}, need = needTypes(), hit = window.vendorMatcher(VW.name), out = {}, byType = {};
  var vl = typeof samplesByVendor === 'function' ? Object.keys(samplesByVendor()) : []; if (!vl.length) vl = Object.keys(window.SETTLE_ENGINES || {});
  var oth = vl.filter(function(n){ return n !== VW.name && !hit(n); }).map(function(n){ return window.vendorMatcher(n); });
  var others = function(fn){ return oth.some(function(f){ return f(fn); }); };   /* 파일 이름에 다른 업체 이름이 붙었나 */
  var ids = Object.keys(BOX).filter(function(id){ var m = BOX[id]; return m && m.type !== 'statement' && !typeInfo(m.type).output && !m.ref; });   /* 업체 참조 파일은 따로 (refFiles) */
  ids.forEach(function(id){ (byType[BOX[id].type] = byType[BOX[id].type] || []).push(id); });
  ids.forEach(function(id){ var m = BOX[id], k = fileSigKey(m);
    if (P[k] != null){ out[id] = { on: !!P[k], saved: true }; return; }
    var on = false;
    if (need[m.type]) on = typeInfo(m.type).cat === 'common' || hit(m.name)
      || (!byType[m.type].some(function(x){ return hit(BOX[x].name); }) && !others(m.name));   /* 그 종류에 이 업체 이름 파일이 없으면 → 다른 업체 이름이 붙은 파일만 빼고 */
    out[id] = { on: on, saved: false }; });
  return out;
}
function selBox(){ var U = fileUse(), o = {}; Object.keys(U).forEach(function(id){ if (U[id].on) o[id] = BOX[id]; }); refFiles().forEach(function(id){ o[id] = BOX[id]; }); return o; }
/* ── 업체 참조 파일 (대표님 2026-10-04): 이 업체에만 쓰는 임시 자료(반품·재고·화물…) — box/{ym}/{id}.ref = 업체키, .use = 용도 · 엔진은 ctx.REF 로 용도별로 씀 ── */
var REF_USES = ['반품', '재고', '화물', '밀크런', '기타'];
function refFiles(){ return Object.keys(BOX).filter(function(id){ return BOX[id] && BOX[id].ref === VW.vkey; }).sort(function(a, b){ return (BOX[a].at || 0) - (BOX[b].at || 0); }); }
function refList(){ return refFiles().map(function(id){ var m = BOX[id]; return { id: id, name: m.name, use: m.use || '기타', type: m.type, m: m }; }); }
function setRefUse(id, use){ db.ref('settlement/box/' + YM + '/' + id + '/use').set(use); }
function addRefFiles(input){
  var use = ($('refUse') || {}).value || '기타', box = $('refQueue'); if (!input.files.length) return;
  Array.prototype.forEach.call(input.files, function(file){ var q = document.createElement('div'); q.className = 'q-item';
    q.innerHTML = '<span class="nm">' + esc(file.name) + '</span><span class="q-prog"><i></i></span><span class="st">대기</span>'; if (box) box.appendChild(q);
    queue = queue.then(function(){ return upload(file, YM, q, { ref: VW.vkey, use: use }); }).catch(function(){}); });
  input.value = '';
}
function refCardHtml(){
  var L = refList();
  return '<div style="border:1px dashed var(--br);border-radius:10px;padding:.6rem .8rem;margin:.2rem 0 .8rem">'
    + '<div style="font-weight:800;margin-bottom:.2rem">📎 참조 파일 <span class="dim sm" style="font-weight:400">— 이 업체 ' + esc(ymLabel(YM)) + ' 정산에만 쓰는 임시 자료 (반품·재고·화물 등). 공통 파일함에 섞이지 않고, 용도에 맞는 룰이 있으면 초안에 반영됩니다</span></div>'
    + (L.length ? L.map(function(f){ var t = typeInfo(f.type);
        return '<div style="display:flex;gap:.5rem;align-items:center;padding:.3rem .1rem;border-bottom:1px solid rgba(255,255,255,.05);flex-wrap:wrap"><span>' + (t.icon || '📎') + '</span><b style="font-weight:600">' + esc(f.name) + '</b>'
          + '<select class="tsel" style="padding:.15rem .4rem" onchange="setRefUse(\'' + f.id + '\', this.value)">' + REF_USES.map(function(u){ return '<option' + (u === f.use ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select>'
          + '<span class="dim sm">' + esc(t.label || f.type) + '</span><span style="margin-left:auto"></span><button class="btn" style="padding:.15rem .55rem" onclick="downFile(\'' + f.id + '\')">내려받기</button><button class="btn r" style="padding:.15rem .55rem" onclick="delFile(\'' + f.id + '\')">삭제</button></div>'; }).join('')
      : '<div class="sm dim" style="padding:.2rem 0">아직 없습니다</div>')
    + '<div style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap"><span class="sm">용도</span><select id="refUse" class="tsel" style="padding:.2rem .4rem">' + REF_USES.map(function(u){ return '<option>' + u + '</option>'; }).join('') + '</select>'
    + '<label class="btn" style="cursor:pointer">＋ 참조 파일 올리기<input type="file" multiple style="display:none" onchange="addRefFiles(this)"></label></div><div id="refQueue"></div></div>';
}
function frIds(){ var S = selBox(); return Object.keys(FREIGHT[YM] || {}).filter(function(fid){ return !BOX[fid] || S[fid]; }); }   /* 체크 해제한 화물 청구서는 빼고 */
function toggleFile(id, on){ var m = BOX[id]; if (m) db.ref('settlement/vendors/' + VW.vkey + '/files/' + fileSigKey(m)).set(on ? 1 : 0); }
function saveFilePicks(){   /* 초안을 만들 때 추천 그대로인 것도 저장 → 다음 달부터 이 체크가 기본 */
  var U = fileUse(), u = {}; Object.keys(U).forEach(function(id){ if (!U[id].saved) u[fileSigKey(BOX[id])] = U[id].on ? 1 : 0; });
  if (Object.keys(u).length) db.ref('settlement/vendors/' + VW.vkey + '/files').update(u);
}
function fileCardHtml(){
  var U = fileUse(), ids = Object.keys(U).sort(function(a, b){ return String(BOX[a].name).localeCompare(String(BOX[b].name), 'ko'); });
  var on = ids.filter(function(id){ return U[id].on; }), off = ids.filter(function(id){ return !U[id].on; }), need = needTypes();
  var row = function(id){ var m = BOX[id], t = typeInfo(m.type), u = U[id];
    return '<label style="display:flex;gap:.5rem;align-items:center;padding:.28rem .2rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05)">'
      + '<input type="checkbox" style="width:17px;height:17px" ' + (u.on ? 'checked' : '') + ' onchange="toggleFile(\'' + id + '\', this.checked)">'
      + '<span>' + (t.icon || '📎') + '</span><b style="font-weight:600">' + esc(m.name) + '</b><span class="dim sm">' + esc(t.label || m.type) + (t.cat === 'common' ? ' · 공통' : '') + '</span>'
      + (u.saved ? '' : '<span class="chk" style="margin-left:auto;font-size:11px" title="아직 정하지 않아 추천으로 체크/해제됨 — 초안을 받으면 이대로 저장">추천</span>') + '</label>'; };
  var miss = Object.keys(need).filter(function(k){ return k !== 'freight' && !on.some(function(id){ return BOX[id].type === k; }); });
  return '<div style="border:1px solid var(--line, #2a3040);border-radius:10px;padding:.6rem .8rem;margin:.2rem 0 .8rem">'
    + '<div style="font-weight:800;margin-bottom:.2rem">📂 이 업체 정산에 쓰는 파일 <span class="dim sm" style="font-weight:400">— 체크한 파일만 열어서 계산합니다 · 다음 달에도 같은 이름 파일은 이 체크 그대로</span></div>'
    + (on.length ? on.map(row).join('') : '<div class="sm dim" style="padding:.3rem 0">체크한 파일이 없습니다</div>')
    + (miss.length ? '<div class="sm" style="color:#fbbf24;margin-top:.35rem">⚠️ 지난달 정산서에 쓰인 종류인데 체크된 파일 없음: ' + miss.map(function(k){ return '<b>' + esc(typeInfo(k).label) + '</b>'; }).join(', ') + ' — 이번 달 파일함에 올렸으면 아래에서 체크</div>' : '')
    + (off.length ? '<details style="margin-top:.4rem"' + (miss.length ? ' open' : '') + '><summary class="sm dim" style="cursor:pointer">안 쓰는 파일 ' + off.length + '개 (열어 보지 않음) — 필요하면 체크</summary>' + off.map(row).join('') + '</details>' : '')
    + '</div>';
}
/* 데이터 시트의 이번 달 원본 후보 */
function srcOptions(s){
  var want = (KIND2BOX[s.kind && s.kind.key] || []), out = [], SB = selBox();
  Object.keys(SB).forEach(function(id){ if (want.indexOf(SB[id].type) >= 0) out.push({ v: id, t: '📎 ' + SB[id].name }); });
  if (s.kind && s.kind.key === 'freight') freightVendors().forEach(function(n){ out.push({ v: '@freight:' + n, t: '🚚 청구서 Sheet1 · ' + n + ' 건' }); });
  return out;
}
function guessSrc(s, opts){
  if (!opts.length) return '';
  if (s.kind && s.kind.key === 'freight'){ var g = guessFreightVendor(); if (g) return '@freight:' + g; }
  if (opts.length === 1) return opts[0].v;
  /* 시트 이름 앞부분(곡_ROW데이터 → 곡)이 파일 이름에 있으면 그 파일 */
  var tok = String(s.name).replace(/_?(ROW데이터|ROW|작업상세|보관비|데이터)$/i, '').replace(/_/g, '');
  for (var i = 0; i < opts.length; i++) if (tok && opts[i].t.indexOf(tok) >= 0) return opts[i].v;
  return opts[0].v;
}

/* ── 이번 달 진행 상태 (원점 → 초안 계산됨 → 완료 확정) — 「처음부터 다시」를 누르면 원점으로 보이게 (대표님 2026-10-03)
   run/{ym}/draft = { at, total, nCheck, name } : 초안을 내려받을 때 저장, 처음부터 다시 = run/{ym} 통째로 지움 */
function runStateHtml(){
  var run = runOf(), d = run.draft, f = (typeof doneOf === 'function') ? doneOf(VW.vkey, YM) : null;
  var step = f ? 3 : d ? 2 : 1, st = function(n, t){ var on = n === step, past = n < step;
    return '<span style="padding:.3rem .7rem;border-radius:999px;font-size:12.5px;font-weight:700;' + (on ? 'background:#60a5fa;color:#0b0d12' : past ? 'background:rgba(96,165,250,.18);color:#93c5fd' : 'background:rgba(255,255,255,.05);color:#6b7280') + '">' + (past ? '✔ ' : '') + t + '</span>'; };
  var line = st(1, '① 원점') + ' <span class="dim">→</span> ' + st(2, '② 초안 계산됨') + ' <span class="dim">→</span> ' + st(3, '③ 완료 확정');
  var msg = f ? '✅ 완료 확정됨 — ' + esc(ftime(f.at)) + (f.total != null ? ' · 합계 ' + won(f.total) + '원' : '')
    : d ? '초안 계산됨 — ' + esc(ftime(d.at)) + (d.total != null ? ' · 포함가 <b>' + won(d.total) + '원</b>' : '') + ' · ⚠️ 특이사항·확인 ' + (d.nCheck || 0) + '건 — 엑셀에서 점검 후 맨 아래 ⑤ 완료 확정'
    : '<b>원점 상태 — 아직 계산 전입니다.</b> 아래 「초안 내려받기」를 누르면 지금 파일함 원본과 지금 룰로 처음부터 계산합니다.';
  return '<div id="runState" style="border:1px solid ' + (step === 1 ? '#fbbf24' : 'var(--line, #2a3040)') + ';border-radius:10px;padding:.6rem .8rem;margin:.2rem 0 .8rem">'
    + '<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">' + line + '</div><div class="sm" style="margin-top:.45rem">' + msg + '</div></div>';
}
function refreshRunState(flash){ var el = $('runState'); if (!el) return; el.outerHTML = runStateHtml();
  if (flash){ var n = $('runState'); if (n){ n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.animate([{ boxShadow: '0 0 0 3px #fbbf24' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600, iterations: 2 }); } } }

/* ── 화면: ④ 이번 달 엑셀 만들기 카드 ── */
function buildCardHtml(A, R){
  var run = runOf(), src = run.src || {}, man = run.manual || {};
  var sheets = A.sheets.filter(function(s){ var m = ((R.sheets || {})[sKey(s.name)] || {}).mode; return m === 'copy' || (s.kind && s.kind.key === 'freight' && m !== 'skip'); });
  var sRows = sheets.map(function(s){
    var k = sKey(s.name), opts = srcOptions(s), cur = src[k] != null ? src[k] : guessSrc(s, opts);
    return '<tr><td><b>' + esc(s.name) + '</b><div class="dim">' + esc(s.kind ? s.kind.label : '') + '</div></td><td>'
      + (opts.length ? '<select class="tsel" style="max-width:420px" data-k="' + esc(k) + '" onchange="setRun(\'src/\'+this.dataset.k, this.value)">'
          + '<option value="-"' + (cur === '-' ? ' selected' : '') + '>— 지난달 그대로 두기 —</option>'
          + opts.map(function(o){ return '<option value="' + esc(o.v) + '"' + (o.v === cur ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select>'
        : '<span class="chk warn">' + esc(ymLabel(YM)) + ' 파일함에 맞는 원본 없음 — 지난달 그대로</span>') + '</td></tr>';
  }).join('');
  var manItems = A.items.filter(function(it){ return !it.zero && (((R.items || {})[it.r] || {}).mode === 'manual'); });
  var mRows = manItems.map(function(it){
    return '<tr><td><b>' + esc(it.name) + '</b><div class="dim">' + it.r + '행 · 지난달 ' + won(it.qty.v) + '</div></td>'
      + '<td><input class="famt" style="width:120px" type="number" data-r="' + it.r + '" value="' + (man[it.r] != null ? man[it.r] : '') + '" placeholder="' + (it.qty.v != null ? it.qty.v : '') + '" onchange="setRun(\'manual/\'+this.dataset.r, this.value)">'
      + ' <span class="dim">비우면 지난달 값</span></td></tr>';
  }).join('');
  var yy = YM.slice(5, 7);
  return runStateHtml() + fileCardHtml() + refCardHtml() + '<div class="card-h"><span class="card-t">④ ' + esc(ymLabel(YM)) + ' 엑셀 만들기</span><span class="card-s">지난달 정산서를 틀로 이 업체 설정·적용 룰대로 만듭니다 — 확인할 칸은 노란색, 적용 결과는 내려받은 뒤 바로 아래에</span></div>'
    + (sRows ? '<div class="sec-note" style="margin:.2rem 0 .3rem">이번 달 원본으로 바꿀 데이터 시트 — 쓸 파일 확인</div><table class="ftbl" style="min-width:0"><tbody>' + sRows + '</tbody></table>'
      : '<div class="sec-note">이번 달 원본으로 바꿀 데이터 시트가 정해지지 않았습니다 (대화창에서 요청하면 업체 설정에 넣습니다).</div>')
    + (mRows ? '<div class="sec-note" style="margin:.7rem 0 .3rem">✏️ 매달 입력 항목 — 이번 달 수량</div><table class="ftbl" style="min-width:0"><tbody>' + mRows + '</tbody></table>' : '')
    + '<div style="display:flex;gap:.6rem;align-items:center;margin-top:.8rem;flex-wrap:wrap"><button class="btn p" id="buildBtn" onclick="buildDraft()">📥 ' + yy + '월_거래내역서_' + esc(VW.name) + '_초안.xlsx 내려받기</button><span class="sm dim">초안입니다 — 엑셀에서 확인·수정해 저장한 뒤 맨 아래 <b>완료 확정</b>에 올려 주세요</span>'
    + '<span class="sm dim" id="buildMsg"></span></div>'
    + '<div id="buildLog">' + buildLogHtml() + '</div>';
}

/* ── 만들기 ── */
function decryptBox(m){ return getBytes(m.path).then(function(ab){ return WMS2FA.decrypt(m.path, m.iv, ab); }); }
function tplHeaderRow(ws){   /* 제목줄 = 위 12줄 중 글자 칸이 가장 많은 줄 */
  var best = 1, bc = 0;
  for (var r = 1; r <= Math.min(ws.rowCount, 12); r++){ var c = 0; ws.getRow(r).eachCell(function(cell){ if (typeof cell.value === 'string' && cell.value.trim()) c++; }); if (c > bc){ bc = c; best = r; } }
  return best;
}
/* 셀 수식 글자 (공유 수식도) */
function fOf(c){ try { return c.type === ExcelJS.ValueType.Formula ? c.formula : null; } catch (e) { return null; } }
function esRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* 시트 갈아끼우기: 제목줄까지(서식 포함)는 지난달 것, 아래는 새 데이터.
   데이터 바로 아래 합계 줄(SUM(G2:G11) 같은)은 새 데이터 아래로 옮기고 범위를 새 행 수에 맞추며,
   다른 시트(거래명세표)에서 그 합계 칸을 가리키던 참조도 옮긴 자리로 고친다 (=반품비!G12 → =반품비!G20). */
function replaceSheet(wb, name, headerRows, rows){
  var old = wb.getWorksheet(name), H = tplHeaderRow(old), warn = [];
  var keep = [], widths = (old.columns || []).map(function(c){ return c.width; }), ord = old.orderNo, views = old.views;
  for (var r = 1; r <= H; r++){ var row = old.getRow(r), cs = []; row.eachCell({ includeEmpty: false }, function(c, n){ cs.push([n, c.value, JSON.parse(JSON.stringify(c.style || {}))]); }); keep.push({ h: row.height, cs: cs }); }
  var tplHeads = []; old.getRow(H).eachCell(function(c, n){ tplHeads[n] = nsp(c.value && c.value.richText ? c.value.richText.map(function(t){ return t.text; }).join('') : c.value); });
  var dataStyle = []; old.getRow(H + 1).eachCell({ includeEmpty: false }, function(c, n){ dataStyle[n] = JSON.parse(JSON.stringify(c.style || {})); });

  /* 합계 줄 찾기: 제목줄 아래 첫 'SUM(열n…' 수식 줄부터 이어지는 합계 줄들 */
  var F = null, Fend = null, last = old.rowCount;
  /* 합계 줄 = 위쪽 데이터 행들을 세로로 더하는 SUM 이 있는 줄 (같은 줄 안의 가로 합 SUM(G2:H2) 은 아님) 또는 '합계' 글자 */
  var isFoot = function(r){ var hit = false;
    old.getRow(r).eachCell(function(c){
      var f = fOf(c);
      if (f){ var m, re = /SUM\(\s*\$?([A-Z]{1,3})\$?(\d+)(?:\s*:\s*\$?([A-Z]{1,3})\$?(\d+))?/gi;
        while ((m = re.exec(f))){ var a = +m[2], b = m[4] != null ? +m[4] : a; if (a > H && b < r && (m[4] == null ? a < r : true)) hit = true; } }
      if (typeof c.value === 'string' && /^\s*(합\s*계|총\s*계|총합계)\s*$/.test(c.value)) hit = true;
    }); return hit; };
  for (var r2 = H + 1; r2 <= last; r2++){ if (isFoot(r2)){ F = r2; break; } }
  var foot = [];
  if (F){
    Fend = F; while (Fend + 1 <= last && isFoot(Fend + 1)) Fend++;
    for (var r3 = F; r3 <= Fend; r3++){ var fr = old.getRow(r3), cs2 = []; fr.eachCell({ includeEmpty: false }, function(c, n){ cs2.push([n, fOf(c), c.value, JSON.parse(JSON.stringify(c.style || {}))]); }); foot.push({ h: fr.height, cs: cs2 }); }
    var after = 0; for (var r4 = Fend + 1; r4 <= last; r4++){ var any = false; old.getRow(r4).eachCell(function(){ any = true; }); if (any) after++; }
    if (after) warn.push('합계 줄 아래 다른 내용 ' + after + '줄은 빠졌습니다');
  }
  var oldDataEnd = F ? F - 1 : last;
  wb.removeWorksheet(old.id);
  var ws = wb.addWorksheet(name, { views: views }); ws.orderNo = ord;
  widths.forEach(function(w, i){ if (w) ws.getColumn(i + 1).width = w; });
  keep.forEach(function(k, i){ var row = ws.getRow(i + 1); if (k.h) row.height = k.h; k.cs.forEach(function(c){ var cell = row.getCell(c[0]); cell.value = c[1]; cell.style = c[2]; }); });
  /* 새 데이터: 원본 제목 → 표본 열 */
  var idx = {}; headerRows.forEach(function(h, i){ var k = nsp(h); if (k && idx[k] == null) idx[k] = i; });
  var map = []; tplHeads.forEach(function(h, n){ if (h && idx[h] != null) map.push([n, idx[h]]); });
  rows.forEach(function(src, i){
    var row = ws.getRow(H + 1 + i);
    map.forEach(function(m){ var v = src[m[1]]; if (v !== '' && v != null){ var cell = row.getCell(m[0]); cell.value = v; if (dataStyle[m[0]]) cell.style = dataStyle[m[0]]; } });
  });
  /* 합계 줄 옮기기 */
  var newEnd = H + Math.max(rows.length, 1), gap = F ? Math.max(0, F - 1 - lastFilled()) : 0, newF = newEnd + 1 + gap, delta = F ? newF - F : 0;
  function lastFilled(){ return oldDataEnd; }   /* 지난달 데이터가 합계 바로 위까지 있다고 본다 */
  if (F){
    var adj = function(f){
      return f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g, function(m, d1, c1, d2, r1, d3, c2, d4, r2x){
        r1 = +r1;
        if (r2x != null){ var e = +r2x;
          if (r1 >= H + 1 && e <= oldDataEnd) return d1 + c1 + d2 + (r1 === H + 1 ? H + 1 : r1) + ':' + d3 + c2 + d4 + newEnd;
          if (r1 >= F && e <= Fend) return d1 + c1 + d2 + (r1 + delta) + ':' + d3 + c2 + d4 + (e + delta);
          return m; }
        if (r1 === H + 1 && oldDataEnd === H + 1 && newEnd > H + 1) return d1 + c1 + d2 + (H + 1) + ':' + c1 + newEnd;   /* SUM(G2) → SUM(G2:G9) */
        if (r1 >= F && r1 <= Fend) return d1 + c1 + d2 + (r1 + delta);
        return m;
      });
    };
    foot.forEach(function(fr, i){ var row = ws.getRow(newF + i); if (fr.h) row.height = fr.h;
      fr.cs.forEach(function(c){ var cell = row.getCell(c[0]); cell.value = c[1] ? { formula: adj(c[1]) } : c[2]; cell.style = c[3]; }); });
    /* 다른 시트에서 이 시트를 가리키는 참조 고치기 */
    var re = new RegExp("((?:'" + esRe(name) + "')|(?:" + esRe(name) + "))!(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Z]{1,3})(\\$?)(\\d+))?", 'g');
    var mv = function(rr){ return (rr >= F && rr <= Fend) ? rr + delta : rr; };
    wb.eachSheet(function(o){ if (o === ws) return;
      o.eachRow(function(row){ row.eachCell(function(c){ var f = fOf(c); if (!f || f.indexOf(name) < 0) return;
        var nf = f.replace(re, function(m, sh, d1, col, d2, rr, d3, col2, d4, rr2){ rr = +rr;
          [rr, rr2 != null ? +rr2 : null].forEach(function(x){ if (x != null && x > H && x < F) warn.push(o.name + ' ' + c.address + ' 이(가) 「' + name + '」 데이터 중간 칸(' + x + '행)을 가리킴 — 직접 확인'); });
          return sh + '!' + d1 + col + d2 + mv(rr) + (rr2 != null ? ':' + d3 + col2 + d4 + mv(+rr2) : ''); });
        if (nf !== f) c.value = { formula: nf, result: c.result };
      }); }); });
  }
  return { header: H, matched: map.length, total: tplHeads.filter(Boolean).length, rows: rows.length, footer: F ? (F + '→' + newF) : '', warn: warn };
}
/* 원본 파일에서 표본 시트와 제목이 가장 많이 겹치는 시트 */
function bestSourceSheet(xwb, tplHeads){
  var want = {}; tplHeads.forEach(function(h){ if (h) want[h] = 1; });
  var best = null;
  xwb.SheetNames.forEach(function(n){
    var aoa = XLSX.utils.sheet_to_json(xwb.Sheets[n], { header: 1, defval: '', blankrows: false }), bi = 0, bs = -1;
    for (var i = 0; i < Math.min(aoa.length, 12); i++){ var s = aoa[i].filter(function(v){ return want[nsp(v)]; }).length; if (s > bs){ bs = s; bi = i; } }
    if (!best || bs > best.score) best = { name: n, score: bs, head: aoa[bi] || [], rows: aoa.slice(bi + 1).filter(function(r){ return r.some(function(v){ return v !== '' && v != null; }); }) };
  });
  return best;
}

/* 초안 만들기 (내려받기·완료 확정 비교에 같이 씀) → { wb, log, name } */
/* ── 화물 흔적 (대표님 2026-10-03): 화물·용차 청구서와 입출고 화물관리 기록에 다른 업체 비용이 섞여 들어오므로
   업체 초안을 만들 때 그 달 청구서(Sheet1, 확인 화면에서 지정한 업체 반영)·입출고 기록에서 이 업체 흔적을 찾아
   ⚠️ 특이사항 + 「점검_화물흔적」 시트(노란 칸)로 보여 줌 — 정산서에 넣는 건 대표님이 점검하면서 직접.
   이름: 업체명 핵심(메이크마인디자인_·_당월분·(괄호) 뗀 것) + SETTLE_ALIASES. 엔진이 traceSkip 이면 건너뜀(포인트나인크루처럼 따로 정산) */
function vendorCore(n){ return String(n || '').replace(/^메이크마인디자인_/, '').replace(/_(당월분|계산서미발행|\d.*)$/, '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/^(주식회사|㈜|\(주\))/, ''); }
function traceCargo(wb, log, skipFreight){
  var hit = window.vendorMatcher(VW.name), core = hit.main;   /* settle_engines.js — 제주맥주위탁_만월회 → 만월회 (제주맥주 기록을 잡지 않게) */
  var T = [];
  if (!skipFreight) frIds().forEach(function(fid){ var F = FREIGHT[YM][fid] || {}, ch = F.chk || {};
    (F.rows || []).forEach(function(r, i){ var vn = frVendor(r, ch[i]); if (!hit(vn)) return;
      T.push(['화물·용차 청구서', r.d, (r.from || '') + ' → ' + (r.to || '') + ' · ' + (r.car || '') + (r.qty ? ' · ' + r.qty : '') + (r.item ? ' ' + r.item : ''), frFinal(r, ch[i]) + (+r.etc || 0), '청구서 업체명 「' + vn + '」' + (r.note ? ' · ' + r.note : '')]); }); });
  var C = (typeof CARGO !== 'undefined' && CARGO && CARGO.rows) ? CARGO.rows : [];
  C.forEach(function(x){ if (!x || String(x.date || '').slice(0, 7) !== YM || !hit(x.vendor)) return;
    var K = { parcel: '택배출고', in: '입고', out: '출고', ret: '반품 양품화', etc: '기타' }[x.kind] || x.kind || '';
    T.push(['입출고 화물관리', x.date, K + ' · 파렛트 ' + ((+x.aj || 0) + (+x.etc || 0)) + (x.box ? ' · 박스 ' + x.box : '') + (x.memo || x.note ? ' · ' + (x.memo || x.note) : ''), +x.fee || null, '업체 「' + x.vendor + '」' + (x.work === 'Y' ? ' · 작업 유' : '')]); });
  if (!T.length){ log.push(['안내', '화물 청구서·입출고 기록에 「' + core + '」 흔적 없음' + (skipFreight ? ' (청구서는 용차비 시트로 따로 들어감)' : '')]); return; }
  T.sort(function(a, b){ return String(a[1]).localeCompare(String(b[1])); });
  var old = wb.getWorksheet('점검_화물흔적'); if (old) wb.removeWorksheet(old.id);
  var ws = wb.addWorksheet('점검_화물흔적'); ws.orderNo = -1; ws.properties.tabColor = { argb: 'FFC00000' };
  ws.columns = [{ width: 16 }, { width: 12 }, { width: 60 }, { width: 13 }, { width: 40 }];
  ws.addRow(['이 업체로 보이는 화물·입출고 기록 — 정산서에 넣을 것은 넣고, 확인했으면 이 시트를 지우세요']).font = { bold: true, size: 12 };
  var hr = ws.addRow(['출처', '날짜', '내용', '금액', '비고']); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.eachCell(function(c){ c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; });
  T.forEach(function(t){ var r = ws.addRow(t); r.getCell(4).numFmt = '#,##0'; for (var c = 1; c <= 5; c++) r.getCell(c).fill = YEL; });
  log.push(['특이사항', '화물 청구서·입출고 기록에 이 업체 흔적 ' + T.length + '건 — 맨 앞 「점검_화물흔적」 시트 (예: ' + T.slice(0, 3).map(function(t){ return t[1] + ' ' + t[2].slice(0, 30) + (t[3] ? ' ' + won(t[3]) + '원' : ''); }).join(' / ') + ')']);
}
function makeDraft(msg){
  msg = msg || function(){};
  var A = VW.A, R = cfgOf(VW.vkey), run = runOf(), eng = engineOf(VW.vkey), log = [], wb;
  var yy = YM.slice(5, 7), dd = lastDay(YM);
  msg('표본 여는 중…');
  return decryptBox(VW.meta).then(function(bytes){
    if (/\.xls$/i.test(VW.meta.name)){   /* 옛 xls 는 xlsx 로 바꿔서 연다 (서식 일부 빠질 수 있음) */
      var x = XLSX.read(bytes, { type: 'array', cellStyles: true }); bytes = XLSX.write(x, { type: 'array', bookType: 'xlsx' });
      log.push(['확인 필요', '표본이 옛 xls 형식이라 테두리·글꼴·도장 같은 서식이 빠집니다 — 엑셀에서 「다른 이름으로 저장 → xlsx」로 바꿔 파일함(표본 달)에 다시 올리면 다음부터 그대로 나옵니다 (확정본도 xlsx 로 저장해 올려 주세요)']);
    }
    wb = new ExcelJS.Workbook(); return wb.xlsx.load(bytes);
  }).then(function(){
    /* 기본 행 높이가 빠진 시트(xls 에서 바꾼 것 등)는 그대로 저장하면 엑셀이 파일을 못 엶 → 채움 (2026-10-03 엠에스컴퍼니 초안이 안 열리던 것) */
    wb.eachSheet(function(ws){ if (!ws.properties || !ws.properties.defaultRowHeight) ws.properties = Object.assign({ defaultRowHeight: 15, dyDescent: 0.55, outlineLevelRow: 0, outlineLevelCol: 0 }, ws.properties || {}); });
    var st = wb.getWorksheet(A.sheet) || wb.worksheets[0];
    /* 1) 날짜 */
    st.eachRow(function(row){ row.eachCell(function(c){
      if (typeof c.value === 'string' && /DATE/i.test(c.value) && /\d{4}/.test(c.value)){ var o = c.value; c.value = c.value.replace(/(\d{4})\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}/, YM.slice(0, 4) + ' . ' + yy + '. ' + dd); if (o !== c.value) log.push(['바꿈', '날짜 ' + o.trim() + ' → ' + c.value.trim()]); }
    }); });
    /* 3) 수량 칸 */
    var qcol = A.header ? A.header.qty + 1 : 7;
    A.items.forEach(function(it){
      if (it.zero) return;
      var cell = st.getRow(it.r).getCell(qcol), rr = (R.items || {})[it.r] || {}, mode = rr.mode;
      var isPivot = it.qty.f && /GETPIVOTDATA/i.test(it.qty.f);
      if (eng && eng.compute && eng.compute[it.r] != null){ cell.value = eng.compute[it.r]; log.push(['자동 계산', it.name + ' = ' + won(eng.compute[it.r])]); return; }
      if (mode === 'manual'){
        var mv = run.manual && run.manual[it.r] != null && run.manual[it.r] !== '' ? +run.manual[it.r] : null;
        if (mv != null){ cell.value = mv; log.push(['입력', it.name + ' = ' + won(mv) + ' (지난달 ' + won(it.qty.v) + ')']); }
        else { cell.value = it.qty.v; cell.fill = YEL; log.push(['확인 필요', it.name + ' — 매번 입력 항목인데 이번 달 값을 안 넣어 지난달 ' + won(it.qty.v) + ' 그대로']); }
        return;
      }
      if (mode === 'fixed'){ if (isPivot) cell.value = it.qty.v; log.push(['고정', it.name + ' = ' + won(it.qty.v) + ' (지난달 그대로)']); return; }
      if (mode === 'auto' && eng && eng.afterBuild) return;   /* 업체 룰(엔진)이 계산하는 줄 — 노란 표시·「직접 입력」 경고 없이 엔진에 맡김 */
      if (isPivot){ cell.value = it.qty.v; cell.fill = YEL; log.push(['확인 필요', it.name + ' — 피벗 계산이라 지난달 값 ' + won(it.qty.v) + ' 그대로' + (rr.text ? ' · 룰: ' + rr.text : '')]); return; }
      if (it.qty.src.kind === 'input' || !it.qty.f){
        /* 매달 같은 줄(솔루션·사용료·관리비·보관비 등)은 지난달 수량 그대로, 그 밖의 직접 입력 줄은 지난달에만 있던 일(입고비·소급·오배송 등)일 수 있어 0 + 노란 칸
           (8월 재현에서 7월 「해외오배송소급 −215,231」·「입고비 파렛트화 201」이 따라와 틀린 것 — 대표님 2026-10-03 「일단 먼저 만들고 맞춰 나감」) */
        var keep = /솔루션|사용료|관리|시스템|보관|월정|기본료|고정|이벗/.test(nsp(it.name));
        if (!keep && +it.qty.v){ cell.value = 0; cell.fill = YEL; log.push(['확인 필요', it.name + ' — 직접 입력 칸, 지난달 ' + won(it.qty.v) + ' → 0 (지난달에만 있던 일이면 그대로, 이번 달에도 있으면 수량 입력)']); return; }
        cell.fill = YEL; log.push(['확인 필요', it.name + ' — 직접 입력 칸, 지난달 값 ' + won(it.qty.v) + ' 그대로 (매달 같은 줄)' + (rr.text ? ' · 룰: ' + rr.text : '')]); return; }
      /* 거래명세표 오른쪽 옆 표(피벗 결과 등, R열 이후)를 가리키는 계산은 지난달 값이 남아 있으므로 확인 */
      if (it.qty.src.kind === 'calc' && /(^|[^A-Z!])([R-Z]|A[A-Z])\$?\d+/.test(it.qty.f)){ cell.fill = YEL; log.push(['확인 필요', it.name + ' — 옆 표(' + it.qty.f + ')를 가리키는 계산이라 지난달 값 ' + won(it.qty.v) + ' 그대로' + (rr.text ? ' · 룰: ' + rr.text : '')]); return; }
      log.push(['수식', it.name + ' — ' + it.qty.src.text + ' (엑셀을 열면 다시 계산)']);
    });
    /* 다른 시트의 피벗 수식도 값으로 (피벗표가 따라오지 않음) */
    wb.eachSheet(function(ws){ if (ws === st) return; ws.eachRow(function(row){ row.eachCell(function(c){ if (c.formula && /GETPIVOTDATA/i.test(c.formula)){ c.value = c.result != null ? c.result : null; c.fill = YEL; } }); }); });
    /* 2) 데이터 시트 — 순서대로 하나씩 */
    var jobs = A.sheets.filter(function(s){ var m = ((R.sheets || {})[sKey(s.name)] || {}).mode; return m === 'copy' || (s.kind && s.kind.key === 'freight' && m !== 'skip'); });
    return jobs.reduce(function(p, s){
      return p.then(function(){
        var k = sKey(s.name), opts = srcOptions(s), sel = (run.src || {})[k] != null ? run.src[k] : guessSrc(s, opts);
        if (!sel || sel === '-'){ log.push(['확인 필요', '시트 「' + s.name + '」 — 이번 달 원본을 고르지 않아 지난달 그대로']); return; }
        if (sel.indexOf('@freight:') === 0){
          var who = sel.slice(9), heads = ['일자','출발지','도착지','차종','수량','운송품목','금액','기타','합계금액','비고','업체명'], rows = [];
          frIds().forEach(function(fid){ var F = FREIGHT[YM][fid] || {}, ch = F.chk || {};
            (F.rows || []).forEach(function(r, i){ var vnm = frVendor(r, ch[i]); if (frBase(vnm) !== who) return; var a = frFinal(r, ch[i]);
              rows.push([r.d, r.from, r.to, r.car, r.qty === '' ? '' : (isFinite(+r.qty) ? +r.qty : r.qty), r.item, a, +r.etc || 0, a + (+r.etc || 0), [r.note, r.extra].filter(Boolean).join(' / '), vnm]); }); });
          rows.sort(function(a, b){ return String(a[0]).localeCompare(String(b[0])); });
          var rs = replaceSheet(wb, s.name, heads, rows);
          rs.warn.forEach(function(w){ log.push(['확인 필요', '시트 「' + s.name + '」 — ' + w]); }); if (rs.footer) log.push(['바꿈', '시트 「' + s.name + '」 합계 줄 ' + rs.footer + '행으로 옮기고 거래명세표 참조도 고침']);
          var sum = rows.reduce(function(t, r){ return t + r[8]; }, 0);
          log.push(['바꿈', '시트 「' + s.name + '」 ← 화물 청구서 Sheet1 「' + who + '」 ' + rows.length + '건, 합계 ' + won(sum) + '원 (확인 화면에서 고친 금액 반영) · 열 ' + rs.matched + '/' + rs.total + ' 맞춤']);
          if (rs.matched < rs.total) log.push(['확인 필요', '시트 「' + s.name + '」 — 제목이 안 맞는 열 ' + (rs.total - rs.matched) + '개는 비어 있음']);
          return;
        }
        var m = BOX[sel]; if (!m){ log.push(['확인 필요', '시트 「' + s.name + '」 — 고른 원본 파일이 파일함에 없음']); return; }
        msg('「' + s.name + '」 원본 여는 중… (' + m.name + ')');
        return decryptBox(m).then(function(bytes){
          var xwb = XLSX.read(bytes, { type: 'array', dense: true });
          var tplHeads = []; var ows = wb.getWorksheet(s.name); ows.getRow(tplHeaderRow(ows)).eachCell(function(c, n){ tplHeads[n] = nsp(c.value); });
          var b = bestSourceSheet(xwb, tplHeads);
          var rs = replaceSheet(wb, s.name, b.head, b.rows);
          rs.warn.forEach(function(w){ log.push(['확인 필요', '시트 「' + s.name + '」 — ' + w]); }); if (rs.footer) log.push(['바꿈', '시트 「' + s.name + '」 합계 줄 ' + rs.footer + '행으로 옮기고 거래명세표 참조도 고침']);
          log.push(['바꿈', '시트 「' + s.name + '」 ← ' + m.name + ' 「' + b.name + '」 ' + rs.rows.toLocaleString() + '행 · 열 ' + rs.matched + '/' + rs.total + ' 맞춤']);
          if (rs.matched < rs.total) log.push(['확인 필요', '시트 「' + s.name + '」 — 원본에 없는 제목 열 ' + (rs.total - rs.matched) + '개는 비어 있음']);
        });
      });
    }, Promise.resolve());
  }).then(function(){
    /* 업체별 자동 처리 (settle_engines.js) */
    if (!(eng && eng.afterBuild)) return;
    msg('업체 룰 적용 중…');
    /* afterBuild 는 Promise 를 돌려줘도 된다 — 이번 달 파일함(BOX)·원본 읽기(readBox → SheetJS 통합문서)·화면 메시지(msg) 제공 */
    var ctx = { YM: YM, A: A, st: wb.getWorksheet(A.sheet) || wb.worksheets[0], log: log, won: won, BOX: selBox(), REF: refList(), msg: msg,   /* 이 업체가 쓰는 파일(체크한 것)만 */
      CARGO: (typeof CARGO !== 'undefined' && CARGO && CARGO.rows) ? CARGO.rows : null,   /* 입출고 화물관리 그 달 기록 */
      readBox: function(m){ var k = m.path || m.p || m.name; if (!RB_CACHE[k]) RB_CACHE[k] = decryptBox(m).then(function(b){ return XLSX.read(b, { type: 'array' }); }); return RB_CACHE[k]; } };   /* 같은 초안 안에서 같은 파일은 한 번만 열기 (주문목록 26MB 를 여러 단계가 읽음) */
    var RB_CACHE = {};
    ctx.REF.forEach(function(f){ log.push(['안내', '📎 참조 파일 「' + f.name + '」 (용도 ' + f.use + ') — 위 「자동 적용」에 이 파일이 안 보이면 이 업체 룰에 그 용도가 아직 없는 것 (직접 확인 · 룰은 대화창에서)']); });
    return Promise.resolve().then(function(){ return eng.afterBuild(wb, ctx); })
      .catch(function(e){ log.push(['확인 필요', '업체 자동 처리 중 오류: ' + ((e && e.message) || e)]); console.error(e); });
  }).then(function(){
    /* 안전장치: 거래명세표에 피벗 수식(GETPIVOTDATA)이 남아 있으면 피벗표가 없어 #REF! → 지난달 값 + 노란 칸 + 확인 필요 (2026-10-04 제주맥주 제주운임추가) */
    var stp = wb.getWorksheet(A.sheet) || wb.worksheets[0];
    stp.eachRow(function(row, r){ row.eachCell(function(c){ var f = fOf(c); if (!f || !/GETPIVOTDATA/i.test(f)) return;
      var name = (txt0(row.getCell(2).value) + ' ' + txt0(row.getCell(6).value)).trim();
      c.value = c.result != null ? c.result : (c.value && c.value.result != null ? c.value.result : 0); c.fill = YEL;
      log.push(['확인 필요', (name || c.address) + ' — 지난달 피벗 수식이 남아 있어 지난달 값 ' + won(+c.value || 0) + ' 으로 바꿈, 이번 달 값 직접 확인']); }); });
    /* 화물 흔적 — 업체 초안마다 (엔진 traceSkip 이면 건너뜀, 표본에 화물 청구서 시트가 있으면 청구서는 그 시트로 이미 들어가므로 입출고만) */
    if (!(eng && eng.traceSkip)) try { traceCargo(wb, log, A.sheets.some(function(s){ return s.kind && s.kind.key === 'freight'; })); } catch (e) { console.error(e); log.push(['확인 필요', '화물 흔적 찾기 오류: ' + ((e && e.message) || e)]); }
    /* 그대로 둔 시트 */
    A.sheets.forEach(function(s){ var m = ((R.sheets || {})[sKey(s.name)] || {}).mode; if (eng && eng.isAuto && s.kind) return; if (eng && eng.ownSheets && eng.ownSheets.test(s.name)) return;   /* 자동 엔진이 종류별로 처리(못 하면 자기가 알림) */
      if (m !== 'copy' && m !== 'skip' && !(s.kind && s.kind.key === 'freight') && (s.rows > 0 || s.usedBy.length)) log.push(['확인 필요', '시트 「' + s.name + '」 — 지난달 내용 그대로 (룰을 정하면 바뀜)' + (s.usedBy.length ? ' · ' + s.usedBy.join(',') + '행이 참조' : '')]); });
    var order = { '확인 필요': 0, '자동 적용': 1, '입력': 2, '바꿈': 3, '자동 계산': 4, '수식': 5, '고정': 6, '안내': 7 };
    log.sort(function(a, b){ return (order[a[0]] != null ? order[a[0]] : 9) - (order[b[0]] != null ? order[b[0]] : 9); });
    var ck = wb.getWorksheet('점검'); if (ck) wb.removeWorksheet(ck.id);
    /* 4) 점검 시트 — 업체 옵션으로 켰을 때만 (기본은 화면에만 보여 줌) */
    if (optOf().checkSheet){
      ck = wb.addWorksheet('점검');
      ck.columns = [{ header: '구분', width: 12 }, { header: '내용', width: 110 }];
      ck.getRow(1).font = { bold: true };
      ck.addRow(['만든 때', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' · 표본 ' + VW.meta.name + ' · ' + ymLabel(YM)]);
      log.forEach(function(l){ var r = ck.addRow(l); if (l[0] === '확인 필요') r.getCell(1).fill = YEL; });
    }
    /* 노란 표시를 끈 업체는 지운다 */
    if (optOf().noYellow) wb.eachSheet(function(ws){ ws.eachRow(function(row){ row.eachCell(function(c){ if (c.fill && c.fill.fgColor && c.fill.fgColor.argb === 'FFFFF2B3') c.fill = { type: 'pattern', pattern: 'none' }; }); }); });
    wb.calcProperties = wb.calcProperties || {}; wb.calcProperties.fullCalcOnLoad = true;
    return { wb: wb, log: log, name: yy + '월_거래내역서_' + VW.name + '.xlsx' };
  });
}
function buildDraft(){
  if (!VW || !VW.A) return;
  var btn = $('buildBtn'), msg = function(t){ var e = $('buildMsg'); if (e) e.textContent = t; }, log, name;
  btn.disabled = true; saveFilePicks();
  makeDraft(msg).then(function(D){
    log = D.log; name = D.name.replace(/\.xlsx$/,'_초안.xlsx');
    msg('엑셀 쓰는 중…');
    return D.wb.xlsx.writeBuffer();
  }).then(function(buf){
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    var nCheck = log.filter(function(l){ return l[0] === '확인 필요' || l[0] === '특이사항'; }).length;
    VW._lastLog = { log: log, name: name, at: Date.now() };
    msg('✔ ' + name + ' 내려받음 — ⚠️ 특이사항·확인 필요 ' + nCheck + '건 (아래)');
    var box = $('buildLog'); if (box) box.innerHTML = buildLogHtml();
    var tl = log.map(function(l){ return l[1]; }).join(' '), tm = tl.match(/포함가 ([\d,]+)/), tot = tm ? +tm[1].replace(/,/g, '') : null;
    var dr = { at: Date.now(), total: tot, nCheck: nCheck, name: name };
    if (!VENDORS[VW.vkey]) VENDORS[VW.vkey] = {}; var V2 = VENDORS[VW.vkey]; V2.run = V2.run || {}; V2.run[YM] = V2.run[YM] || {}; V2.run[YM].draft = dr;
    refreshRunState(false); setRun('draft', dr);
  }).catch(function(e){ msg('실패: ' + ((e && (e.code || e.message)) || e)); console.error(e); })
    .then(function(){ btn.disabled = false; });
}
