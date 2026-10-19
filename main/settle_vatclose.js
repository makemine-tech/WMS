/* ============================================================
   정산관리 — 🧮 부가세 관리 › 📋 마감집계 (대표님 2026-10-19)
   엑셀 「박스앤캔_어반샵_메이크마인_n기예정_마감집계」를 그대로 한 화면 입력양식으로
   - 사업자 3곳: 박스앤캔 · 어반샵 · 메이크마인디자인 주식회사
   - 기간 4개/년: 1기예정(1~3월) · 1기확정(4~6월) · 2기예정(7~9월) · 2기확정(10~12월) → 해마다 누적
   - 칸에 「436798716+43679872」처럼 +/− 식을 넣을 수 있음 (엑셀처럼 내역 남김) — 저장도 식 그대로
   - 계산은 엑셀과 같음: 부가세 예상 = (매출 − 매입) − (매출 − 매입) ÷ 1.1
       박스앤캔 납부 = 부가세 예상 − (신용카드+현금영수증) × 1.3% − 기납부액
       어반샵 납부 = 부가세 예상 − 예정시 기납부액
       메이크마인 납부 = 부가세 예상 − 환급금
   - 마감집계 엑셀(.xls)을 이 탭에 끌어다 놓으면 시트마다 기간을 읽어 칸을 채움 (B2 「박스앤캔 매출기간 2026년 7월~9월」)
   DB: settlement/vat/close/{YYYY}_{k} (k 1~4) = { bc:{칸:식}, ub:{…}, mm:{…}, memo:{bc,ub,mm,all}, at, by, src }
   쓰는 전역: db, me, esc, toast, $, XLSX, firebase, VAT_OPT, vatOpt, vW (settle_vat.js)
============================================================ */
var VCLOSE = {}, VC_DRAFT = null, VC_LISTEN = false;
var VC_K = [null, { t: '1기 예정', m: '1월~3월' }, { t: '1기 확정', m: '4월~6월' }, { t: '2기 예정', m: '7월~9월' }, { t: '2기 확정', m: '10월~12월' }];

/* 칸 정의 — [키, 이름, 엑셀 셀(불러오기용), 옵션] */
var VC_BIZ = [
  { id: 'bc', nm: '박스앤캔', g: [
    { t: '세금계산서 매출', f: [['taxSale', '전자세금계산서 매출액', 'E6'], ['taxCnt', '건수', 'D6', { cnt: 1 }]] },
    { t: '오픈마켓 매출', f: [['omCard', '신용카드', 'B10'], ['omCash', '현금영수증', 'C10'], ['omEtc', '휴대폰·기타', 'D10']] },
    { t: '추가 매출', f: [['extraSale', '예상 추가매출 마감', 'H15']] },
    { t: '매입', s: '종이세금계산서·신용카드매입 제외한 금액은 세금계산서 매입 칸', f: [['buyCard', '신용카드 매입 (예상)', 'B20'], ['buyPaper', '종이세금계산서 매입', 'C20'], ['buyTax', '세금계산서 매입', 'D20']] },
    { t: '기납부', f: [['prepaid', '예정시 기납부액', 'E27']] }
  ] },
  { id: 'ub', nm: '어반샵', g: [
    { t: '매출', f: [['taxSale', '국세청 계산서 매출', 'B35'], ['selfSale', '외부매출 자진신고 매출', 'C35']] },
    { t: '매입', f: [['buyCard', '신용카드 매입 (예상)', 'D35'], ['buyTax', '국세청 매입총액', 'E35']] },
    { t: '기납부', f: [['prepaid', '예정시 기납부액', 'E36']] }
  ] },
  { id: 'mm', nm: '메이크마인디자인', full: '메이크마인디자인 주식회사', g: [
    { t: '매출', f: [['taxSale', '국세청 계산서 매출', 'B44'], ['selfSale', '외부매출 자진신고 매출', 'C44']] },
    { t: '매입', f: [['buyCard', '신용카드 매입 (예상)', 'D44'], ['buyTax', '국세청 매입총액', 'E44'], ['buyPaper', '종이계산서 매입', 'H44']] },
    { t: '환급', f: [['refund', '환급금', 'E49']] }
  ] }
];

function vcListen(){
  if (VC_LISTEN) return; VC_LISTEN = true;
  db.ref('settlement/vat/close').on('value', function(s){ VCLOSE = s.val() || {}; if (typeof vatRe === 'function') vatRe(); });
}
function vcDefP(){ var n = new Date(Date.now() + 9 * 3600e3), m = n.getUTCMonth(), y = n.getUTCFullYear(); if (m === 0){ m = 12; y--; } return { y: y, k: Math.ceil(m / 3) }; }   /* 지난달이 든 기 = 지금 신고할 기 */
function vcP(){ var p = VAT_OPT.cp; return p && p.y && p.k ? p : vcDefP(); }
function vcKey(p){ return p.y + '_' + p.k; }
function vcLabel(p){ return p.y + '년 ' + VC_K[p.k].t; }

/* ── 식 계산 (+ − 만, 쉼표·원 무시) ── */
function vcClean(s){ return String(s == null ? '' : s).replace(/[,\s원₩=]/g, '').replace(/[−–]/g, '-'); }
function vcEval(s){
  var t = vcClean(s); if (!t) return 0;
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(t)) return NaN;
  return (t.match(/[+-]?\d+(\.\d+)?/g) || []).reduce(function(a, x){ return a + (+x); }, 0);
}
function vcShow(s){   /* 저장된 식 → 쉼표 넣어 보여주기 */
  var t = vcClean(s); if (!t) return '';
  if (!/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(t)) return String(s);
  return t.replace(/\d+(\.\d+)?/g, function(x){ var p = x.split('.'); return (+p[0]).toLocaleString('ko-KR') + (p[1] ? '.' + p[1] : ''); });
}

/* ── 계산 (엑셀과 같은 식) ── */
function vcCalc(id, d){
  var v = function(k){ var n = vcEval(d && d[k]); return isNaN(n) ? 0 : n; }, o = {};
  if (id === 'bc'){
    o.sale = v('omCard') + v('omCash') + v('omEtc') + v('taxSale') + v('extraSale');
    o.buy = v('buyCard') + v('buyPaper') + v('buyTax');
  } else if (id === 'ub'){
    o.sale = v('taxSale') + v('selfSale'); o.buy = v('buyCard') + v('buyTax');
  } else {
    o.sale = v('taxSale') + v('selfSale'); o.buy = v('buyCard') + v('buyTax') + v('buyPaper');
  }
  o.diff = o.sale - o.buy;
  o.vat = o.diff - o.diff / 1.1;
  o.ded = id === 'bc' ? -(v('omCard') + v('omCash')) * 0.013 : 0;
  o.less = id === 'mm' ? v('refund') : v('prepaid');
  o.pay = o.vat + o.ded - o.less;
  return o;
}
function vcRec(p){ var k = vcKey(p); return VC_DRAFT && VC_DRAFT.key === k ? VC_DRAFT.d : (VCLOSE[k] || {}); }
function vcTotal(rec){ return VC_BIZ.reduce(function(s, B){ return s + vcCalc(B.id, rec[B.id]).pay; }, 0); }

/* ═══ 화면 ═══ */
function renderVatClose(){
  var p = vcP(), rec = vcRec(p), dirty = VC_DRAFT && VC_DRAFT.key === vcKey(p), saved = VCLOSE[vcKey(p)];
  var yNow = new Date().getFullYear(), ys = []; for (var y = Math.min(2025, p.y); y <= Math.max(yNow + 1, p.y); y++) ys.push(y);
  var h = '<style>'
    + '.vc-top{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-bottom:.7rem}'
    + '.vc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin-bottom:.8rem}@media(max-width:1100px){.vc-grid{grid-template-columns:1fr}}'
    + '.vc-b{background:var(--s1);border:1px solid var(--br);border-radius:12px;padding:.75rem .85rem}'
    + '.vc-bt{font-size:15px;font-weight:800}.vc-bp{font-size:11.5px;color:var(--mu);margin-bottom:.5rem}'
    + '.vc-g{border-top:1px solid var(--br);padding:.45rem 0 .25rem}.vc-gt{font-size:11.5px;font-weight:800;color:var(--b);margin-bottom:.25rem}.vc-gt span{font-weight:500;color:var(--mu)}'
    + '.vc-r{display:flex;align-items:center;gap:.4rem;padding:.12rem 0}.vc-r label{flex:1;font-size:12.5px;min-width:0}'
    + '.vc-r input{width:58%;max-width:230px;text-align:right;font-family:var(--mo);font-size:12.5px;padding:.28rem .45rem}.vc-r input.cnt{max-width:90px}.vc-r input.bad{border-color:var(--r);color:var(--r)}'
    + '.vc-ev{font-size:10.5px;color:var(--mu);text-align:right;font-family:var(--mo);margin:-.05rem 0 .1rem}'
    + '.vc-out{border-top:2px solid var(--br);margin-top:.35rem;padding-top:.4rem}.vc-o{display:flex;justify-content:space-between;font-size:12.5px;padding:.12rem 0}.vc-o b{font-family:var(--mo)}'
    + '.vc-o.pay{font-size:14px;font-weight:800;border-top:1px dashed var(--br);margin-top:.25rem;padding-top:.35rem}'
    + '.vc-memo{width:100%;margin-top:.45rem;font-size:12px;padding:.3rem .45rem;min-height:2.2em;resize:vertical}'
    + '.vc-sum{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;background:var(--s2);border:1px solid var(--br);border-radius:12px;padding:.7rem 1rem;margin-bottom:.8rem}'
    + '.vc-sum .it{display:flex;flex-direction:column;line-height:1.3}.vc-sum .it span{font-size:11px;color:var(--mu)}.vc-sum .it b{font-family:var(--mo);font-size:15px}'
    + '.vc-sum .tot b{font-size:20px}.vc-hist tr{cursor:pointer}.vc-hist tr.on td{background:rgba(96,165,250,.08)}.vc-hist tr.yr td{font-weight:800;border-top:2px solid var(--br);cursor:default}'
    + '</style>';
  h += '<div class="vc-top"><span class="bar-t">📋 부가세 마감집계</span>'
    + '<button class="btn" onclick="vcShift(-1)">◀</button>'
    + '<select class="tsel" onchange="vcGo({ y: +this.value, k: vcP().k })">' + ys.map(function(y){ return '<option' + (y === p.y ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>'
    + '<select class="tsel" onchange="vcGo({ y: vcP().y, k: +this.value })">' + [1, 2, 3, 4].map(function(k){ return '<option value="' + k + '"' + (k === p.k ? ' selected' : '') + '>' + VC_K[k].t + ' (' + VC_K[k].m + ')</option>'; }).join('') + '</select>'
    + '<button class="btn" onclick="vcShift(1)">▶</button>'
    + '<span class="sm dim">' + p.y + '년 ' + VC_K[p.k].m + ' 마감 · ' + (saved ? '저장됨 ' + ftime(saved.at) + (saved.src ? ' · ' + esc(saved.src) : '') : '<span style="color:var(--y)">아직 저장 안 함</span>') + '</span>'
    + '<span style="flex:1"></span>'
    + '<span id="vcDirty" class="sm" style="color:var(--y)">' + (dirty ? '● 저장 안 한 변경' : '') + '</span>'
    + (dirty ? '<button class="btn" onclick="vcUndo()">되돌리기</button>' : '')
    + '<button class="btn p" onclick="vcSave()">💾 저장</button>'
    + '<label class="btn" title="엑셀 마감집계 파일(.xls)에서 칸 채우기 — 시트마다 기간을 읽습니다">📊 엑셀 불러오기<input type="file" accept=".xls,.xlsx" multiple style="display:none" onchange="vcFiles(this.files);this.value=\'\'"></label></div>';
  /* 3사 합계 */
  h += '<div class="vc-sum">' + VC_BIZ.map(function(B){ return '<div class="it"><span>' + B.nm + ' 납부예정</span><b data-vco="' + B.id + '.pay"></b></div>'; }).join('<span class="dim">+</span>')
    + '<span class="dim">=</span><div class="it tot"><span>3개 사업자 부가세 납부예정 합계</span><b data-vco="all.pay"></b></div>'
    + '<span style="flex:1"></span><span class="sm dim">참고용 예상 — 신용카드 매입은 예상치</span></div>';
  /* 사업자 3칸 */
  h += '<div class="vc-grid" id="vcForm">';
  VC_BIZ.forEach(function(B){
    var d = rec[B.id] || {};
    h += '<div class="vc-b"><div class="vc-bt">' + esc(B.full || B.nm) + '</div><div class="vc-bp">매출기간 ' + p.y + '년 ' + VC_K[p.k].m + ' 마감</div>';
    B.g.forEach(function(G){
      h += '<div class="vc-g"><div class="vc-gt">' + G.t + (G.s ? ' <span>· ' + G.s + '</span>' : '') + '</div>';
      G.f.forEach(function(F){ var cnt = F[3] && F[3].cnt, val = vcShow(d[F[0]]);
        h += '<div class="vc-r"><label for="vc_' + B.id + '_' + F[0] + '">' + F[1] + '</label><input type="text" inputmode="decimal" id="vc_' + B.id + '_' + F[0] + '" data-b="' + B.id + '" data-f="' + F[0] + '"' + (cnt ? ' class="cnt"' : '')
          + ' value="' + esc(val) + '" placeholder="0" oninput="vcIn(this)" onblur="vcBlur(this)"></div><div class="vc-ev" data-vcev="' + B.id + '.' + F[0] + '"></div>'; });
      h += '</div>';
    });
    var outs = [['sale', '매출총액'], ['buy', '매입총액'], ['diff', '매출 − 매입'], ['vat', '부가세 예상 (차액 − 차액÷1.1)']];
    if (B.id === 'bc') outs.push(['ded', '신용카드·현금영수증 공제 (−1.3%)']);
    outs.push(['less', B.id === 'mm' ? '환급금 (−)' : '예정시 기납부액 (−)']);
    h += '<div class="vc-out">' + outs.map(function(o){ return '<div class="vc-o"><span>' + o[1] + '</span><b data-vco="' + B.id + '.' + o[0] + '"></b></div>'; }).join('')
      + '<div class="vc-o pay"><span>부가세 납부예정액</span><b data-vco="' + B.id + '.pay"></b></div></div>'
      + '<textarea class="vc-memo" data-memo="' + B.id + '" placeholder="메모 (누락된 매입, 확인할 것 등)" oninput="vcIn(this)">' + esc((rec.memo || {})[B.id] || '') + '</textarea></div>';
  });
  h += '</div>';
  h += '<div class="card" style="padding:.6rem .8rem"><textarea class="vc-memo" style="margin:0" data-memo="all" placeholder="이번 기 전체 메모" oninput="vcIn(this)">' + esc((rec.memo || {}).all || '') + '</textarea></div>';
  /* 누적 */
  var keys = Object.keys(VCLOSE).filter(function(k){ return /^\d{4}_[1-4]$/.test(k); }).sort().reverse();
  h += '<div class="card"><div class="card-h"><span class="card-t">📚 기간별 누적</span><span class="card-s">줄을 누르면 그 기간을 엽니다 · 금액 = 저장된 값 기준</span></div>';
  if (keys.length){
    h += '<div class="vt-scroll"><table class="ftbl vtt vc-hist"><thead><tr><th>기간</th>' + VC_BIZ.map(function(B){ return '<th class="n">' + B.nm + ' 매출</th><th class="n">매입</th><th class="n">납부예정</th>'; }).join('') + '<th class="n">합계 납부예정</th></tr></thead><tbody>';
    var yr = null, ysum = 0, flush = function(){ if (yr != null) h += '<tr class="yr"><td>' + yr + '년 합계</td><td colspan="' + (VC_BIZ.length * 3) + '"></td><td class="n">' + vcWon(ysum) + '</td></tr>'; };
    keys.forEach(function(k){ var y = +k.slice(0, 4), kk = +k.slice(5), r = VCLOSE[k];
      if (y !== yr){ flush(); yr = y; ysum = 0; }
      var t = vcTotal(r); ysum += t;
      h += '<tr' + (k === vcKey(p) ? ' class="on"' : '') + ' onclick="vcGo({ y: ' + y + ', k: ' + kk + ' })"><td><b>' + y + ' ' + VC_K[kk].t + '</b><div class="sm dim">' + VC_K[kk].m + '</div></td>'
        + VC_BIZ.map(function(B){ var c = vcCalc(B.id, r[B.id]); return '<td class="n">' + vW(c.sale) + '</td><td class="n">' + vW(c.buy) + '</td><td class="n"><b>' + vcWon(c.pay) + '</b></td>'; }).join('')
        + '<td class="n"><b>' + vcWon(t) + '</b></td></tr>'; });
    flush();
    h += '</tbody></table></div>';
  } else h += '<div class="empty-s">아직 저장한 기간이 없습니다 — 위 칸을 채우고 💾 저장하거나, 마감집계 엑셀을 불러오세요.</div>';
  h += '</div>';
  return h;
}
function vcWon(n){ n = Math.round(n); return n < 0 ? '<span style="color:var(--g)">(' + vW(-n) + ')</span>' : vW(n); }

/* 화면의 계산 칸만 다시 채우기 (입력 중에도) */
function vcFill(){
  var rec = vcRec(vcP()), all = 0;
  VC_BIZ.forEach(function(B){ var c = vcCalc(B.id, rec[B.id]); all += c.pay;
    Object.keys(c).forEach(function(k){ document.querySelectorAll('[data-vco="' + B.id + '.' + k + '"]').forEach(function(e){
      e.innerHTML = k === 'pay' ? vcWon(c.pay) : k === 'ded' || k === 'less' ? (c[k] ? (k === 'less' ? '−' : '') + vW(c[k]) : '0') : vW(c[k]); }); });
    B.g.forEach(function(G){ G.f.forEach(function(F){ var e = document.querySelector('[data-vcev="' + B.id + '.' + F[0] + '"]'), s = (rec[B.id] || {})[F[0]], t = vcClean(s), n = vcEval(s);
      var inp = $('vc_' + B.id + '_' + F[0]); if (inp) inp.classList.toggle('bad', isNaN(n));
      if (e) e.textContent = isNaN(n) ? '숫자와 + − 만 넣을 수 있습니다' : /\d[+-]/.test(t) ? '= ' + vW(n) : ''; }); });
  });
  document.querySelectorAll('[data-vco="all.pay"]').forEach(function(e){ e.innerHTML = vcWon(all); });
}
function vcIn(el){
  var p = vcP(), k = vcKey(p);
  if (!VC_DRAFT || VC_DRAFT.key !== k) VC_DRAFT = { key: k, d: JSON.parse(JSON.stringify(VCLOSE[k] || {})) };
  var d = VC_DRAFT.d;
  if (el.dataset.memo){ d.memo = d.memo || {}; d.memo[el.dataset.memo] = el.value; }
  else { d[el.dataset.b] = d[el.dataset.b] || {}; d[el.dataset.b][el.dataset.f] = vcClean(el.value); }
  var dd = $('vcDirty'); if (dd) dd.textContent = '● 저장 안 한 변경';
  vcFill();
}
function vcBlur(el){ var n = vcEval(el.value); if (!isNaN(n)) el.value = vcShow(el.value); }
function vcLeaveOk(){ return !(VC_DRAFT && VC_DRAFT.key === vcKey(vcP())) || confirm(vcLabel(vcP()) + ' 에 저장 안 한 변경이 있습니다. 버리고 이동할까요?'); }
function vcGo(p){ if (!vcLeaveOk()){ renderVat(); return; } VC_DRAFT = null; vatOpt('cp', p); }
function vcShift(d){ var p = Object.assign({}, vcP()); p.k += d; if (p.k < 1){ p.k = 4; p.y--; } if (p.k > 4){ p.k = 1; p.y++; } vcGo(p); }
function vcView(v){ if (v === VAT_OPT.view || (v === 'close' && VAT_OPT.view !== 'data')) return; if (v === 'data' && !vcLeaveOk()) return; VC_DRAFT = null; vatOpt('view', v); }
function vcUndo(){ if (!confirm('저장 안 한 변경을 버리고 저장된 값으로 되돌릴까요?')) return; VC_DRAFT = null; renderVat(); }

/* 저장할 모양으로 정리 (빈 칸·빈 메모 빼기) */
function vcPack(d){
  var o = {}, bad = [];
  VC_BIZ.forEach(function(B){ var s = d[B.id] || {}, x = {};
    B.g.forEach(function(G){ G.f.forEach(function(F){ var t = vcClean(s[F[0]]); if (!t) return; if (isNaN(vcEval(t))) bad.push(B.nm + ' ' + F[1]); x[F[0]] = t; }); });
    if (Object.keys(x).length) o[B.id] = x; });
  var m = {}; Object.keys(d.memo || {}).forEach(function(k){ var t = String(d.memo[k] || '').trim(); if (t) m[k] = t.slice(0, 1000); });
  if (Object.keys(m).length) o.memo = m;
  return { o: o, bad: bad };
}
function vcSave(){
  var p = vcP(), k = vcKey(p), P = vcPack(vcRec(p));
  if (P.bad.length){ toast('숫자로 읽을 수 없는 칸: ' + P.bad.join(', ')); return; }
  var rec = Object.assign(P.o, { at: firebase.database.ServerValue.TIMESTAMP, by: (me && me.email) || '', src: '화면 입력' });
  db.ref('settlement/vat/close/' + k).set(rec).then(function(){ VC_DRAFT = null; toast('💾 ' + vcLabel(p) + ' 저장 — 3사 납부예정 ' + vW(vcTotal(P.o)) + '원'); renderVat(); })
    .catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); });
}

/* ═══ 마감집계 엑셀 불러오기 ═══ */
/* 시트마다 { p, d } — B2 에 「박스앤캔 매출기간 2026년 7월~9월」 이 있어야 마감집계 양식으로 봄 */
function vcParseWb(wb){
  var out = [];
  wb.SheetNames.forEach(function(sn){
    var ws = wb.Sheets[sn]; if (!ws) return;
    var t = String((ws.B2 && ws.B2.v) || ''), m = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
    if (!/박스앤캔/.test(t) || !/매출기간/.test(t) || !m) return;
    var mo = +m[2], k = mo <= 3 ? 1 : mo <= 6 ? 2 : mo <= 9 ? 3 : 4, d = {};
    VC_BIZ.forEach(function(B){ var x = {};
      B.g.forEach(function(G){ G.f.forEach(function(F){ var c = ws[F[2]]; if (!c) return;
        var f = c.f ? String(c.f).replace(/^=/, '') : '', v;
        if (f && /^[\d+\-.\s]+$/.test(f)) v = f.replace(/\s/g, '');            /* 「=436798716+43679872」 식 그대로 */
        else if (typeof c.v === 'number') v = String(Math.round(c.v * 100) / 100);
        else if (c.v != null && !isNaN(vcEval(c.v)) && vcClean(c.v)) v = vcClean(c.v);
        if (v && v !== '0') x[F[0]] = v; }); });
      if (Object.keys(x).length) d[B.id] = x; });
    out.push({ sheet: sn, p: { y: +m[1], k: k }, d: d, title: t });
  });
  return out;
}
/* 부가세 탭에 끌어다 놓은 파일이 마감집계면 여기서 받음 → true */
function vcTryFile(name, buf){
  if (!/\.xlsx?$/i.test(name)) return false;
  var wb; try { wb = XLSX.read(buf, { type: 'array', cellFormula: true }); } catch (e) { return false; }
  var L = vcParseWb(wb); if (!L.length) return false;
  vcImport(name, L); return true;
}
function vcFiles(list){
  Array.prototype.forEach.call(list, function(file){
    file.arrayBuffer().then(function(buf){ if (!vcTryFile(file.name, buf)) toast('「' + file.name + '」 — 마감집계 양식(B2 「박스앤캔 매출기간 ○년 ○월~○월」)을 찾지 못했습니다'); });
  });
}
function vcImport(name, L){
  var seen = {};
  L = L.filter(function(x){ var k = vcKey(x.p); if (seen[k]) return false; seen[k] = 1; return true; });   /* 같은 기간 시트가 둘이면 앞 시트 */
  var over = L.filter(function(x){ return VCLOSE[vcKey(x.p)]; });
  var msg = '「' + name + '」 에서 ' + L.length + '개 기간을 찾았습니다:\n\n' + L.map(function(x){ return '· 시트 ' + x.sheet + ' → ' + vcLabel(x.p) + ' — 3사 납부예정 ' + vW(vcTotal(x.d)) + '원' + (VCLOSE[vcKey(x.p)] ? '  ⚠ 이미 저장된 값 덮어씀' : ''); }).join('\n')
    + '\n\n저장할까요?';
  if (!confirm(msg)) return;
  var u = {};
  L.forEach(function(x){ var P = vcPack(x.d); u[vcKey(x.p)] = Object.assign(P.o, { at: firebase.database.ServerValue.TIMESTAMP, by: (me && me.email) || '', src: '엑셀 ' + name.slice(0, 80) + ' · ' + x.sheet }); });
  db.ref('settlement/vat/close').update(u).then(function(){
    VC_DRAFT = null; toast('📊 ' + L.map(function(x){ return vcLabel(x.p); }).join(', ') + ' 불러와 저장' + (over.length ? ' (덮어씀 ' + over.length + ')' : ''));
    VAT_OPT.cp = L[0].p; vatOpt('view', 'close');
  }).catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); });
}
