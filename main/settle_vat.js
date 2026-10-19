/* ============================================================
   정산관리 — 🧮 부가세 관리 (대표님 2026-10-18 · 삼자물류정산관리 탭 옆)
   ① 매출 = WMS 삼자물류정산관리 정산금액(VAT 포함) — 2026년 10월분부터 (계산서 일괄발행 양식과 같은 나눔: 공급가액 = 금액 ÷ 1.1 반올림 · 세액 = 금액 − 공급가액)
   ② 매입 = 세금계산서 금액 직접 입력 (날짜·거래처·사업자번호·공급가액·세액·비고) — 매출도 직접 넣을 수 있음
   ③ 부가세 마감 자료 올리기 = 홈택스 등 엑셀(전자세금계산서 목록 매출·매입 · 사업용카드 매입 · 현금영수증) → 열 머리글로 종류 판별
      - 세금계산서 매출/매입 = 줄마다 공급자·공급받는자 사업자번호가 우리(메이크마인디자인 119-86-94602)인지로 나눔
      - 판별이 애매하면 추정하지 않고 「특이사항」 맨 위 — 대표님이 종류를 직접 고르면 그때 반영
      - 같은 승인번호(같은 거래)는 두 번 넣지 않음
   ④ 기간(월·분기·반기)별 매출세액 − 매입세액 = 납부(환급) 예정 · WMS 매출과 올린 매출자료가 다르면 월·거래처별 차이
   DB: settlement/vat/files/{fid} = { name, kind, sheet, n, dup, from, to, sale{n,sup,tax}, buy{n,sup,tax}, warn[], info[], at, by }
       settlement/vat/rows/{fid}  = [ { d, dir(sale|buy), k(tax|card|cash), nm, biz, sup, tax, no, ded(false=불공제) } ]
       settlement/vat/man/{id}    = { d, dir, k(tax|card|cash|etc), nm, biz, sup, tax, memo, ded, at }
   쓰는 전역: db, me, esc, toast, $, XLSX, firebase, monthVendors, lgState, lgStage, lgNorm, LEXTRA, LINFO, LG_SUP (settle_ledger.js)
============================================================ */
var VAT_WMS_FROM = '2026-10';   /* 이 달부터 WMS 정산금액이 발행매출 */
var VFILES = {}, VROWS = {}, VMAN = {}, VAT_PEND = [], VAT_EDIT = null, VAT_LISTEN = false;
var VAT_OPT = (function(){ try { return JSON.parse(localStorage.getItem('vatOpt')) || null; } catch (e) { return null; } })();
if (!VAT_OPT || !VAT_OPT.p){ var _n = new Date(Date.now() + 9 * 3600e3); VAT_OPT = { p: { t: 'q', y: _n.getUTCFullYear(), n: Math.floor(_n.getUTCMonth() / 3) + 1 }, base: 'wms' }; }
function vatOpt(k, v){ VAT_OPT[k] = v; try { localStorage.setItem('vatOpt', JSON.stringify(VAT_OPT)); } catch (e) {} renderVat(); }
function vatOur(){ return String(typeof LG_SUP !== 'undefined' ? LG_SUP.biz : '1198694602').replace(/\D/g, ''); }
var vW = function(n){ return n == null || n === '' ? '' : Math.round(+n).toLocaleString('ko-KR'); };
var vBiz = function(v){ return String(v == null ? '' : v).replace(/\D/g, ''); };
var vBizF = function(b){ b = vBiz(b); return b.length === 10 ? b.slice(0, 3) + '-' + b.slice(3, 5) + '-' + b.slice(5) : b; };
var VK_LB = { tax: '세금계산서', card: '카드', cash: '현금영수증', etc: '기타' };

function vatListen(){
  if (VAT_LISTEN) return; VAT_LISTEN = true;
  db.ref('settlement/vat/files').on('value', function(s){ VFILES = s.val() || {}; vatRe(); });
  db.ref('settlement/vat/rows').on('value', function(s){ VROWS = s.val() || {}; vatRe(); });
  db.ref('settlement/vat/man').on('value', function(s){ VMAN = s.val() || {}; vatRe(); });
  if (typeof vcListen === 'function') vcListen();   /* 📋 마감집계 (settle_vatclose.js) */
  /* WMS 매출이 바뀌면(정산금액·업체 정보·확정본) 다시 */
  ['settlement/ledger', 'settlement/ledgerExtra', 'settlement/ledgerInfo', 'settlement/vendors'].forEach(function(p){ db.ref(p).on('value', function(){ setTimeout(vatRe, 0); }); });
}
function vatRe(){
  var el = $('tabVat'); if (!el || el.classList.contains('hide')) return;
  var a = document.activeElement; if (a && a.closest && a.closest('#vatForm,#vcForm,.vc-memo')) return;   /* 입력 중이면 그대로 */
  renderVat();
}

/* ── 기간 ── */
function vatMonths(p){
  var ms = p.t === 'm' ? [p.n] : p.t === 'q' ? [p.n * 3 - 2, p.n * 3 - 1, p.n * 3] : (p.n === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12]);
  return ms.map(function(m){ return p.y + '-' + String(m).padStart(2, '0'); });
}
function vatPLabel(p){
  if (p.t === 'm') return p.y + '년 ' + p.n + '월';
  if (p.t === 'q') return p.y + '년 ' + p.n + '분기 (' + (p.n * 3 - 2) + '~' + (p.n * 3) + '월) · ' + (p.n <= 2 ? '1기' : '2기') + ' ' + (p.n % 2 ? '예정' : '확정');
  return p.y + '년 ' + p.n + '기 (' + (p.n === 1 ? '1~6' : '7~12') + '월)';
}
function vatDue(p){   /* 신고·납부 기한 = 기간 끝난 다음 달 25일 (월은 참고) */
  var last = vatMonths(p).pop(), y = +last.slice(0, 4), m = +last.slice(5, 7) + 1; if (m > 12){ m = 1; y++; }
  return y + '-' + String(m).padStart(2, '0') + '-25';
}
function vatShift(d){
  var p = Object.assign({}, VAT_OPT.p), max = p.t === 'm' ? 12 : p.t === 'q' ? 4 : 2;
  p.n += d; if (p.n < 1){ p.n = max; p.y--; } if (p.n > max){ p.n = 1; p.y++; }
  vatOpt('p', p);
}
function vatSetT(t){
  var p = VAT_OPT.p, m = p.t === 'm' ? p.n : p.t === 'q' ? p.n * 3 - 2 : (p.n === 1 ? 1 : 7);
  vatOpt('p', { t: t, y: p.y, n: t === 'm' ? m : t === 'q' ? Math.ceil(m / 3) : (m <= 6 ? 1 : 2) });
}

/* ── ① WMS 매출 (삼자물류정산관리 정산금액) ── */
function vatWms(ym){
  if (ym < VAT_WMS_FROM || typeof monthVendors !== 'function' || typeof lgState !== 'function') return null;
  var out = [];
  monthVendors(ym).forEach(function(v){ if (v.skip) return; var s = lgState('v', v.vk, ym, 0, v.name); if (!s.amt) return;
    var I = (LINFO || {})[v.vk] || {}; out.push({ name: v.name, corp: I.corp || '', biz: vBiz(I.biz), amt: Math.round(s.amt), src: s.src, stg: lgStage(s.rec) }); });
  var X = (LEXTRA || {})[ym] || {};
  Object.keys(X).forEach(function(id){ var s = lgState('x', id, ym, 0); if (!s.amt) return; var x = X[id];
    out.push({ name: x.name || '(이름 없음)', corp: x.corp || '', biz: vBiz(x.biz), amt: Math.round(s.amt), src: '기타 거래처', stg: lgStage(x), extra: true }); });
  out.forEach(function(r){ r.sup = Math.round(r.amt / 1.1); r.tax = r.amt - r.sup; });
  var t = { rows: out, sup: 0, tax: 0 }; out.forEach(function(r){ t.sup += r.sup; t.tax += r.tax; });
  return out.length ? t : null;
}

/* ── 올린 자료 + 직접 입력 → 그 달 줄 ── */
function vatAllRows(){
  var L = [];
  Object.keys(VROWS).forEach(function(fid){ if (!VFILES[fid]) return; (VROWS[fid] || []).forEach(function(r){ if (r) L.push(Object.assign({ fid: fid }, r)); }); });
  Object.keys(VMAN).forEach(function(id){ var m = VMAN[id]; if (m) L.push(Object.assign({ man: id }, m)); });
  return L;
}
/* 파일 자료가 이 달을 덮나 (세금계산서 매출 목록 기간 안) */
function vatFileCovers(ym){ return Object.keys(VFILES).some(function(f){ var F = VFILES[f]; return F.kind === 'tax' && F.sale && F.sale.n && F.from && F.to && F.from.slice(0, 7) <= ym && F.to.slice(0, 7) >= ym; }); }

function vatCalc(p){
  var ms = vatMonths(p), all = vatAllRows(), M = {};
  ms.forEach(function(ym){
    var W = vatWms(ym), rows = all.filter(function(r){ return r.d && r.d.slice(0, 7) === ym; });
    var fS = rows.filter(function(r){ return r.fid && r.dir === 'sale' && r.k === 'tax'; });
    var o = { ym: ym, W: W, rows: rows, fS: fS, fSsup: 0, fStax: 0, cover: vatFileCovers(ym) || fS.length > 0,
      sOther: { sup: 0, tax: 0 }, buy: { sup: 0, tax: 0, tax_t: 0, tax_c: 0, tax_h: 0, tax_m: 0 }, nod: { sup: 0, tax: 0, n: 0 } };
    fS.forEach(function(r){ o.fSsup += +r.sup || 0; o.fStax += +r.tax || 0; });
    rows.forEach(function(r){ var sup = +r.sup || 0, tax = +r.tax || 0;
      if (r.dir === 'sale'){ if (!(r.fid && r.k === 'tax')){ o.sOther.sup += sup; o.sOther.tax += tax; } return; }
      if (r.ded === false){ o.nod.sup += sup; o.nod.tax += tax; o.nod.n++; return; }
      o.buy.sup += sup; o.buy.tax += tax;
      if (r.man) o.buy.tax_m += tax; else if (r.k === 'card') o.buy.tax_c += tax; else if (r.k === 'cash') o.buy.tax_h += tax; else o.buy.tax_t += tax; });
    /* 세금계산서 매출 기준: WMS(기본) ↔ 올린 자료 — 한쪽만 있으면 있는 쪽 */
    var useW = W && (VAT_OPT.base !== 'file' || !o.cover);
    o.base = useW ? 'WMS' : o.cover ? '자료' : '';
    o.sSup = (useW ? W.sup : o.fSsup) + o.sOther.sup; o.sTax = (useW ? W.tax : o.fStax) + o.sOther.tax;
    o.pay = o.sTax - o.buy.tax;
    M[ym] = o;
  });
  var T = { sSup: 0, sTax: 0, bSup: 0, bTax: 0, pay: 0, nod: 0 };
  ms.forEach(function(ym){ var o = M[ym]; T.sSup += o.sSup; T.sTax += o.sTax; T.bSup += o.buy.sup; T.bTax += o.buy.tax; T.pay += o.pay; T.nod += o.nod.tax; });
  return { ms: ms, M: M, T: T };
}

/* WMS ↔ 올린 매출자료 거래처별 차이 (둘 다 있는 달만) */
function vatDiff(C){
  var out = [];
  C.ms.forEach(function(ym){ var o = C.M[ym]; if (!o.W || !o.cover) return;
    var G = {}, key = function(biz, nm){ return biz ? 'b' + biz : 'n' + (typeof lgNorm === 'function' ? lgNorm(nm) : String(nm || '').replace(/\s/g, '')); };
    var nameKey = {};   /* 사업자번호 없는 WMS 업체 → 자료의 같은 상호로 */
    o.fS.forEach(function(r){ var k = key(vBiz(r.biz), r.nm); var g = G[k] = G[k] || { nm: r.nm, biz: vBiz(r.biz), wS: 0, wT: 0, fS: 0, fT: 0, wN: [] }; g.fS += +r.sup || 0; g.fT += +r.tax || 0;
      nameKey[typeof lgNorm === 'function' ? lgNorm(r.nm) : r.nm] = k; });
    o.W.rows.forEach(function(r){ var k = r.biz ? key(r.biz) : (nameKey[lgNorm(r.corp || r.name)] || nameKey[lgNorm(r.name)] || key('', r.corp || r.name));
      var g = G[k] = G[k] || { nm: r.corp || r.name, biz: r.biz, wS: 0, wT: 0, fS: 0, fT: 0, wN: [] }; g.wS += r.sup; g.wT += r.tax; g.wN.push(r.name); });
    Object.keys(G).forEach(function(k){ var g = G[k]; if (Math.abs(g.wS - g.fS) > 1 || Math.abs(g.wT - g.fT) > 1) out.push(Object.assign({ ym: ym }, g)); });
  });
  return out;
}

/* ── 특이사항 (애매한 건 추정하지 않고 맨 위) ── */
function vatIssues(C){
  var I = [], now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  VAT_PEND.forEach(function(P, i){
    var pick = P.cand && P.cand.length ? ' <select class="tsel" style="font-size:12px" onchange="vatPick(' + i + ', this.value)"><option value="">종류 직접 고르기…</option>'
      + P.cand.map(function(c){ return '<option value="' + c + '">' + ({ card_buy: '💳 카드 매입', cash_buy: '🧾 현금영수증 매입', cash_sale: '🧾 현금영수증 매출', tax_sale: '📄 세금계산서 매출', tax_buy: '📄 세금계산서 매입' }[c] || c) + '</option>'; }).join('') + '</select>' : '';
    I.push({ lv: '🔴', t: '<b>' + esc(P.name) + '</b>' + (P.sheet ? ' <span class="dim">(시트 ' + esc(P.sheet) + ')</span>' : '') + ' — 반영 안 함: ' + esc(P.reason)
      + (P.heads && P.heads.length ? '<div class="sm dim">찾은 열 머리글: ' + esc(P.heads.slice(0, 18).join(' · ')) + '</div>' : '') + pick
      + ' <button class="btn" style="font-size:11px;padding:.05rem .45rem" onclick="VAT_PEND.splice(' + i + ',1);renderVat()">닫기</button>' });
  });
  Object.keys(VFILES).forEach(function(f){ var F = VFILES[f]; if (!F.warn || !F.warn.length) return;
    if (F.to && F.from && (F.to.slice(0, 7) < C.ms[0] || F.from.slice(0, 7) > C.ms[C.ms.length - 1])) return;
    I.push({ lv: '🟡', t: '<b>' + esc(F.name) + '</b> — ' + F.warn.map(esc).join(' · ') }); });
  C.ms.forEach(function(ym){ var o = C.M[ym], lb = (+ym.slice(5, 7)) + '월';
    if (ym <= now && !o.W && !o.cover && !o.sOther.sup) I.push({ lv: '🟡', t: lb + ' 매출 자료가 없습니다 — ' + (ym < VAT_WMS_FROM ? '9월분까지는 WMS 매출이 없으니 홈택스 매출 세금계산서 목록을 올려 주세요' : '삼자물류정산관리에 정산금액이 없습니다') });
    if (o.W){
      var dr = o.W.rows.filter(function(r){ return r.src !== '확정본' && !r.extra; });
      if (dr.length) I.push({ lv: '🟡', t: lb + ' WMS 매출 중 확정본 아닌 금액 ' + dr.length + '곳 — ' + esc(dr.map(function(r){ return r.name + '(' + r.src + ')'; }).join(', ')) });
      var ni = o.W.rows.filter(function(r){ return r.stg < 2; });
      if (ni.length && ym < now) I.push({ lv: '🟡', t: lb + ' 계산서 발행 전(진행 2단계 전) ' + ni.length + '곳 — ' + esc(ni.map(function(r){ return r.name; }).join(', ')) });
      if (o.cover){ var nb = o.W.rows.filter(function(r){ return !r.biz; }); if (nb.length) I.push({ lv: '🟡', t: lb + ' 사업자번호 없는 WMS 업체 ' + nb.length + '곳 — 상호로만 대조 (삼자물류정산관리 ⚙ 에서 사업자번호 넣기): ' + esc(nb.map(function(r){ return r.name; }).join(', ')) }); }
    }
  });
  var D = vatDiff(C);
  if (D.length){ var sd = D.reduce(function(s, d){ return s + d.wT - d.fT; }, 0); I.push({ lv: '🟡', t: 'WMS 매출과 올린 매출자료가 다른 거래처 ' + D.length + '곳 · 세액 차이 ' + (sd > 0 ? '+' : '') + vW(sd) + '원 — 아래 「매출 차이」 표' }); }
  /* 직접 입력 ↔ 올린 자료 같은 거래 의심 (사업자번호·날짜·공급가액 같음) */
  var fr = vatAllRows().filter(function(r){ return r.fid; }), dupM = [];
  Object.keys(VMAN).forEach(function(id){ var m = VMAN[id]; if (!m || !m.d || C.ms.indexOf(m.d.slice(0, 7)) < 0) return;
    if (fr.some(function(r){ return r.dir === m.dir && r.d === m.d && Math.abs((+r.sup || 0) - (+m.sup || 0)) <= 1 && (!m.biz || !r.biz || vBiz(m.biz) === vBiz(r.biz)); })) dupM.push(m.d.slice(5) + ' ' + (m.nm || '') + ' ' + vW(m.sup)); });
  if (dupM.length) I.push({ lv: '🟡', t: '직접 입력한 줄이 올린 자료와 같은 거래로 보입니다 (두 번 셈 주의) — ' + esc(dupM.join(', ')) });
  return I;
}

/* ═══ 화면 ═══ */
function renderVat(){
  var el = $('tabVat'); if (!el) return;
  var p = VAT_OPT.p, C = vatCalc(p), T = C.T, IS = vatIssues(C);
  var card = function(t, v, s, c){ return '<div class="vt-card"><span class="vt-ct">' + t + '</span><b' + (c ? ' style="color:' + c + '"' : '') + '>' + v + '</b>' + (s ? '<span class="vt-cs">' + s + '</span>' : '') + '</div>'; };
  var nmax = p.t === 'm' ? 12 : p.t === 'q' ? 4 : 2, yNow = new Date().getFullYear(), ys = [];
  for (var y = Math.min(2025, p.y); y <= Math.max(yNow + 1, p.y); y++) ys.push(y);
  var h = '<style>'
    + '.vt-top{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-bottom:.6rem}'
    + '.vt-iss{border:1px solid rgba(251,191,36,.5);background:rgba(251,191,36,.06);border-radius:12px;padding:.6rem .8rem;margin-bottom:.8rem}'
    + '.vt-iss .it{font-size:12.5px;line-height:1.6;padding:.25rem 0;border-top:1px solid rgba(251,191,36,.15)}.vt-iss .it:first-of-type{border-top:none}'
    + '.vt-cards{display:flex;gap:.45rem;margin-bottom:.8rem;flex-wrap:wrap}.vt-card{flex:1;min-width:150px;background:var(--s2);border:1px solid var(--br);border-radius:9px;padding:.4rem .7rem;display:flex;flex-direction:column;line-height:1.3}'
    + '.vt-ct{font-size:11px;color:var(--mu)}.vt-card b{font-size:17px}.vt-cs{font-size:10.5px;color:var(--mu)}'
    + '.vt-scroll{overflow-x:auto}.vtt{min-width:860px}.vtt td.n,.vtt th.n{text-align:right}.vtt tr.tot td{font-weight:800;border-top:2px solid var(--br)}'
    + '#vatForm{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}#vatForm input,#vatForm select{font-size:12.5px;padding:.3rem .4rem}'
    + '.vt-sec>summary{cursor:pointer;font-weight:800;font-size:13.5px;padding:.2rem 0}'
    + '.vt-view{display:flex;gap:.3rem;margin-bottom:.8rem;flex-wrap:wrap}.vt-view .btn{font-size:13px;padding:.4rem .9rem}.vt-view .btn.on{background:var(--b);border-color:var(--b);color:#0b0d12}'
    + '</style>';
  /* 📋 마감집계(3개 사업자 한 화면 입력) ↔ 📊 자료 분석 */
  var view = VAT_OPT.view === 'data' || typeof renderVatClose !== 'function' ? 'data' : 'close';
  h += '<div class="vt-view"><button class="btn' + (view === 'close' ? ' on' : '') + '" onclick="vcView(&quot;close&quot;)">📋 마감집계 입력 (박스앤캔·어반샵·메이크마인)</button>'
    + '<button class="btn' + (view === 'data' ? ' on' : '') + '" onclick="vcView(&quot;data&quot;)">📊 자료 분석 (WMS 매출·홈택스 자료)</button></div>';
  if (view === 'close'){ el.innerHTML = h + renderVatClose(); vcFill(); return; }
  /* 특이사항 맨 위 */
  if (IS.length) h += '<div class="vt-iss"><div style="font-weight:800;margin-bottom:.3rem">⚠️ 특이사항 ' + IS.length + '건 <span class="sm dim" style="font-weight:500">— 추정해서 넣지 않았습니다. 확인 후 고르거나 고쳐 주세요</span></div>'
    + IS.map(function(x){ return '<div class="it">' + x.lv + ' ' + x.t + '</div>'; }).join('') + '</div>';
  h += '<div class="vt-top"><span class="bar-t">🧮 부가세 관리</span>'
    + '<select class="tsel" onchange="vatSetT(this.value)">' + [['m', '월'], ['q', '분기'], ['h', '반기(1기·2기)']].map(function(o){ return '<option value="' + o[0] + '"' + (p.t === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
    + '<button class="btn" onclick="vatShift(-1)">◀</button>'
    + '<select class="tsel" onchange="vatOpt(\'p\', Object.assign({}, VAT_OPT.p, { y: +this.value }))">' + ys.map(function(y){ return '<option' + (y === p.y ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select>'
    + '<select class="tsel" onchange="vatOpt(\'p\', Object.assign({}, VAT_OPT.p, { n: +this.value }))">' + Array.apply(null, Array(nmax)).map(function(_, i){ var n = i + 1; return '<option value="' + n + '"' + (n === p.n ? ' selected' : '') + '>' + (p.t === 'm' ? n + '월' : p.t === 'q' ? n + '분기' : n + '기') + '</option>'; }).join('') + '</select>'
    + '<button class="btn" onclick="vatShift(1)">▶</button>'
    + '<span class="sm dim">' + esc(vatPLabel(p)) + (p.t !== 'm' ? ' · 신고·납부 기한 ' + vatDue(p) : '') + '</span><span style="flex:1"></span>'
    + '<span class="sm dim">세금계산서 매출 기준</span><select class="tsel" onchange="vatOpt(\'base\', this.value)"><option value="wms"' + (VAT_OPT.base !== 'file' ? ' selected' : '') + '>WMS 정산금액 (기본)</option><option value="file"' + (VAT_OPT.base === 'file' ? ' selected' : '') + '>올린 매출자료</option></select></div>';
  h += '<div class="vt-cards">'
    + card('매출 공급가액', '₩' + vW(T.sSup), '매출세액 ₩' + vW(T.sTax))
    + card('매입 공급가액 (공제)', '₩' + vW(T.bSup), '매입세액 ₩' + vW(T.bTax) + (T.nod ? ' · 불공제 세액 ₩' + vW(T.nod) + ' 제외' : ''))
    + card(T.pay >= 0 ? '납부 예정 부가세' : '환급 예정 부가세', '₩' + vW(Math.abs(T.pay)), '매출세액 − 매입세액 · 참고용 (공제·가산세 등 제외)', T.pay >= 0 ? '#f87171' : 'var(--g)')
    + '</div>';
  /* 월별 표 */
  h += '<div class="card"><div class="card-h"><span class="card-t">월별 계산</span><span class="card-s">매출 = 세금계산서(' + (VAT_OPT.base === 'file' ? '올린 자료 우선' : 'WMS 우선') + ') + 카드·현금·직접 매출 · WMS 매출은 ' + (+VAT_WMS_FROM.slice(5)) + '월분(' + VAT_WMS_FROM.slice(0, 4) + ')부터</span></div><div class="vt-scroll"><table class="ftbl vtt"><thead><tr>'
    + '<th>월</th><th>매출 기준</th><th class="n">매출 공급가액</th><th class="n">매출세액</th><th class="n">WMS 세액</th><th class="n">자료 세액</th><th class="n">차이</th>'
    + '<th class="n">매입 공급가액</th><th class="n">매입세액</th><th>매입세액 내역</th><th class="n">납부(환급)</th></tr></thead><tbody>';
  C.ms.forEach(function(ym){ var o = C.M[ym], d = o.W && o.cover ? o.W.tax - o.fStax : null;
    var parts = [['세금계산서', o.buy.tax_t], ['카드', o.buy.tax_c], ['현금', o.buy.tax_h], ['직접', o.buy.tax_m]].filter(function(x){ return x[1]; }).map(function(x){ return x[0] + ' ' + vW(x[1]); }).join(' · ');
    h += '<tr><td><b>' + (+ym.slice(5, 7)) + '월</b></td><td>' + (o.base ? '<span class="pill" style="margin:0">' + o.base + '</span>' : '<span class="dim">없음</span>') + '</td>'
      + '<td class="n">' + vW(o.sSup) + '</td><td class="n"><b>' + vW(o.sTax) + '</b></td>'
      + '<td class="n">' + (o.W ? vW(o.W.tax) : '<span class="dim">-</span>') + '</td><td class="n">' + (o.cover ? vW(o.fStax) : '<span class="dim">-</span>') + '</td>'
      + '<td class="n">' + (d == null ? '' : Math.abs(d) <= 1 ? '<span style="color:var(--g)">일치</span>' : '<b style="color:var(--y)">' + (d > 0 ? '+' : '') + vW(d) + '</b>') + '</td>'
      + '<td class="n">' + vW(o.buy.sup) + '</td><td class="n"><b>' + vW(o.buy.tax) + '</b></td><td class="sm dim">' + esc(parts) + (o.nod.n ? ' · 불공제 ' + o.nod.n + '건 제외' : '') + '</td>'
      + '<td class="n"><b style="color:' + (o.pay >= 0 ? '#f87171' : 'var(--g)') + '">' + (o.pay < 0 ? '(' + vW(-o.pay) + ')' : vW(o.pay)) + '</b></td></tr>'; });
  h += '<tr class="tot"><td colspan="2">합계</td><td class="n">' + vW(T.sSup) + '</td><td class="n">' + vW(T.sTax) + '</td><td colspan="3"></td><td class="n">' + vW(T.bSup) + '</td><td class="n">' + vW(T.bTax) + '</td><td></td><td class="n">' + (T.pay < 0 ? '(' + vW(-T.pay) + ')' : vW(T.pay)) + '</td></tr>'
    + '</tbody></table></div><div class="sec-note" style="margin-top:.4rem">차이 = WMS 세액 − 올린 매출자료(세금계산서) 세액 · 납부 (괄호) = 환급</div></div>';
  /* 매출 차이 */
  var D = vatDiff(C);
  if (D.length) h += '<div class="card"><div class="card-h"><span class="card-t">매출 차이 — WMS ↔ 올린 매출자료 (거래처별)</span><span class="card-s">사업자번호로 맞추고, 없으면 상호로</span></div><div class="vt-scroll"><table class="ftbl vtt"><thead><tr><th>월</th><th>거래처</th><th>사업자번호</th><th class="n">WMS 공급가액</th><th class="n">WMS 세액</th><th class="n">자료 공급가액</th><th class="n">자료 세액</th><th class="n">세액 차이</th><th>설명</th></tr></thead><tbody>'
    + D.map(function(d){ var why = !d.fS && !d.fT ? 'WMS 에만 있음 (계산서 미발행?)' : !d.wS && !d.wT ? '올린 자료에만 있음 (WMS 정산 밖 매출?)' : '금액 다름'; var dt = d.wT - d.fT;
      return '<tr><td>' + (+d.ym.slice(5, 7)) + '월</td><td><b>' + esc(d.nm) + '</b>' + (d.wN.length && d.wN.join(', ') !== d.nm ? '<div class="sm dim">WMS: ' + esc(d.wN.join(', ')) + '</div>' : '') + '</td><td>' + esc(vBizF(d.biz)) + '</td>'
        + '<td class="n">' + vW(d.wS) + '</td><td class="n">' + vW(d.wT) + '</td><td class="n">' + vW(d.fS) + '</td><td class="n">' + vW(d.fT) + '</td><td class="n"><b style="color:var(--y)">' + (dt > 0 ? '+' : '') + vW(dt) + '</b></td><td class="sm">' + why + '</td></tr>'; }).join('')
    + '</tbody></table></div></div>';
  /* 자료 올리기 */
  h += '<div class="card"><div class="card-h"><span class="card-t">📥 부가세 마감 자료 올리기</span><span class="card-s">홈택스 엑셀 — 전자세금계산서 목록(매출·매입) · 사업용 신용카드 매입 · 현금영수증 매입 · 열 머리글로 종류 자동 판별 · 같은 거래는 한 번만</span></div>'
    + '<label class="drop" style="display:block;margin-bottom:.6rem;padding:1rem"><div class="ic">📊</div><b>엑셀(.xls·.xlsx·.csv)을 여기로 끌어다 놓거나 눌러서 고르세요</b><div class="s">여러 개 한꺼번에 · 이 탭을 보고 있을 때 끌어다 놓으면 파일함이 아니라 여기로 들어옵니다</div>'
    + '<input type="file" multiple accept=".xls,.xlsx,.csv" style="display:none" onchange="vatFiles(this.files);this.value=\'\'"></label>';
  var fids = Object.keys(VFILES).sort(function(a, b){ return (VFILES[b].at || 0) - (VFILES[a].at || 0); });
  h += fids.length ? '<div class="vt-scroll"><table class="ftbl vtt"><thead><tr><th>파일</th><th>종류</th><th>기간</th><th class="n">매출</th><th class="n">매입</th><th>메모</th><th></th></tr></thead><tbody>'
    + fids.map(function(f){ var F = VFILES[f], sb = function(x){ return x && x.n ? x.n + '건 · 공급 ' + vW(x.sup) + ' · 세액 ' + vW(x.tax) : '<span class="dim">-</span>'; };
      return '<tr><td><b>' + esc(F.name) + '</b><div class="sm dim">' + (F.sheet ? '시트 ' + esc(F.sheet) + ' · ' : '') + ftime(F.at) + '</div></td><td>' + esc(VK_LB[F.kind] || F.kind) + '</td><td class="sm">' + esc((F.from || '') + ' ~ ' + (F.to || '')) + '</td>'
        + '<td class="n sm">' + sb(F.sale) + '</td><td class="n sm">' + sb(F.buy) + '</td><td class="sm">' + (F.warn || []).map(function(w){ return '<div style="color:var(--y)">' + esc(w) + '</div>'; }).join('') + (F.info || []).map(function(w){ return '<div class="dim">' + esc(w) + '</div>'; }).join('') + '</td>'
        + '<td><button class="btn r" style="padding:.05rem .45rem" onclick="vatDelFile(\'' + f + '\')">삭제</button></td></tr>'; }).join('') + '</tbody></table></div>'
    : '<div class="empty-s">아직 올린 자료가 없습니다.</div>';
  h += '</div>';
  /* 직접 입력 */
  var E = VAT_EDIT && VMAN[VAT_EDIT] ? VMAN[VAT_EDIT] : { d: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), dir: 'buy', k: 'tax', ded: true };
  var sel = function(id, v, opts){ return '<select id="' + id + '" class="tsel">' + opts.map(function(o){ return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
  h += '<div class="card"><div class="card-h"><span class="card-t">✍️ 매입 세금계산서 직접 입력</span><span class="card-s">저장하면 다른 PC에서도 보임 · 공급가액을 넣으면 세액 10% 자동 (고칠 수 있음) · 매출도 넣을 수 있음</span></div>'
    + '<div id="vatForm">'
    + '<input type="date" id="vf_d" value="' + esc(E.d || '') + '">'
    + sel('vf_dir', E.dir || 'buy', [['buy', '매입'], ['sale', '매출']])
    + sel('vf_k', E.k || 'tax', [['tax', '세금계산서'], ['card', '카드'], ['cash', '현금영수증'], ['etc', '기타']])
    + '<input type="text" id="vf_nm" placeholder="거래처" style="width:150px" value="' + esc(E.nm || '') + '">'
    + '<input type="text" id="vf_biz" placeholder="사업자번호" style="width:115px" value="' + esc(E.biz ? vBizF(E.biz) : '') + '">'
    + '<input type="text" id="vf_sup" placeholder="공급가액" style="width:110px;text-align:right" value="' + (E.sup != null ? vW(E.sup) : '') + '" oninput="vatSupIn()">'
    + '<input type="text" id="vf_tax" placeholder="세액" style="width:95px;text-align:right" value="' + (E.tax != null ? vW(E.tax) : '') + '" oninput="this.dataset.touched=1">'
    + '<input type="text" id="vf_memo" placeholder="비고" style="width:160px" value="' + esc(E.memo || '') + '">'
    + '<label class="sm" title="매입세액 불공제(접대비·비영업용 승용차 등)면 끄기"><input type="checkbox" id="vf_ded"' + (E.ded !== false ? ' checked' : '') + '> 공제</label>'
    + '<button class="btn p" onclick="vatSave()">' + (VAT_EDIT ? '고쳐 저장' : '저장') + '</button>' + (VAT_EDIT ? '<button class="btn" onclick="VAT_EDIT=null;renderVat()">취소</button>' : '') + '</div>';
  var man = Object.keys(VMAN).filter(function(id){ var m = VMAN[id]; return m && m.d && C.ms.indexOf(m.d.slice(0, 7)) >= 0; }).sort(function(a, b){ return String(VMAN[b].d).localeCompare(String(VMAN[a].d)); });
  h += man.length ? '<div class="vt-scroll" style="margin-top:.6rem"><table class="ftbl vtt"><thead><tr><th>날짜</th><th>구분</th><th>증빙</th><th>거래처</th><th>사업자번호</th><th class="n">공급가액</th><th class="n">세액</th><th>비고</th><th></th></tr></thead><tbody>'
    + man.map(function(id){ var m = VMAN[id]; return '<tr' + (m.ded === false ? ' style="opacity:.6"' : '') + '><td>' + esc(m.d) + '</td><td>' + (m.dir === 'sale' ? '매출' : '매입') + '</td><td>' + esc(VK_LB[m.k] || '') + (m.ded === false ? ' <span class="pill">불공제</span>' : '') + '</td><td><b>' + esc(m.nm || '') + '</b></td><td>' + esc(vBizF(m.biz)) + '</td>'
      + '<td class="n">' + vW(m.sup) + '</td><td class="n">' + vW(m.tax) + '</td><td class="sm">' + esc(m.memo || '') + '</td>'
      + '<td style="white-space:nowrap"><button class="btn" style="padding:.05rem .4rem" onclick="VAT_EDIT=\'' + id + '\';renderVat()">✏️</button> <button class="btn r" style="padding:.05rem .4rem" onclick="vatDelMan(\'' + id + '\')">×</button></td></tr>'; }).join('') + '</tbody></table></div>'
    : '<div class="empty-s">' + esc(vatPLabel(p)) + ' 에 직접 넣은 줄이 없습니다.</div>';
  h += '</div>';
  /* 상세 */
  h += '<div class="card"><details class="vt-sec"><summary>📄 매출 상세 — WMS 정산금액 (업체별)</summary><div class="vt-scroll"><table class="ftbl vtt"><thead><tr><th>월</th><th>업체</th><th>사업자번호</th><th class="n">정산금액(VAT 포함)</th><th class="n">공급가액</th><th class="n">세액</th><th>출처</th><th>진행</th></tr></thead><tbody>';
  var anyW = false;
  C.ms.forEach(function(ym){ var o = C.M[ym]; if (!o.W) return; anyW = true;
    o.W.rows.forEach(function(r){ h += '<tr><td>' + (+ym.slice(5, 7)) + '월</td><td><b>' + esc(r.name) + '</b>' + (r.corp && r.corp !== r.name ? '<div class="sm dim">' + esc(r.corp) + '</div>' : '') + '</td><td>' + (r.biz ? esc(vBizF(r.biz)) : '<span style="color:var(--y)">없음</span>') + '</td>'
      + '<td class="n">' + vW(r.amt) + '</td><td class="n">' + vW(r.sup) + '</td><td class="n">' + vW(r.tax) + '</td><td class="sm">' + esc(r.src) + '</td><td class="sm">' + ['대기', '전달완료', '계산서발행', '체크완료'][r.stg] + '</td></tr>'; }); });
  if (!anyW) h += '<tr><td colspan="8" class="dim">이 기간에 WMS 매출이 없습니다 (' + (+VAT_WMS_FROM.slice(5)) + '월분부터)</td></tr>';
  h += '</tbody></table></div></details></div>';
  var BG = {}; C.ms.forEach(function(ym){ C.M[ym].rows.forEach(function(r){ if (r.dir !== 'buy') return; var k = vBiz(r.biz) || r.nm || '?', g = BG[k] = BG[k] || { nm: r.nm, biz: vBiz(r.biz), n: 0, sup: 0, tax: 0, nod: 0, ks: {} }; g.n++; g.sup += +r.sup || 0; g.tax += +r.tax || 0; if (r.ded === false) g.nod += +r.tax || 0; g.ks[r.man ? '직접' : VK_LB[r.k]] = 1; }); });
  var bk = Object.keys(BG).sort(function(a, b){ return BG[b].tax - BG[a].tax; });
  h += '<div class="card"><details class="vt-sec"><summary>🧾 매입 상세 — 거래처별 (' + bk.length + '곳)</summary><div class="vt-scroll"><table class="ftbl vtt"><thead><tr><th>거래처</th><th>사업자번호</th><th>증빙</th><th class="n">건수</th><th class="n">공급가액</th><th class="n">세액</th><th class="n">불공제 세액</th></tr></thead><tbody>'
    + (bk.length ? bk.map(function(k){ var g = BG[k]; return '<tr><td><b>' + esc(g.nm || '') + '</b></td><td>' + esc(vBizF(g.biz)) + '</td><td class="sm">' + esc(Object.keys(g.ks).join(' · ')) + '</td><td class="n">' + g.n + '</td><td class="n">' + vW(g.sup) + '</td><td class="n">' + vW(g.tax) + '</td><td class="n">' + (g.nod ? vW(g.nod) : '') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="dim">이 기간 매입이 없습니다</td></tr>')
    + '</tbody></table></div></details></div>';
  el.innerHTML = h;
}

/* ── 직접 입력 ── */
function vatParse(s){ var t = String(s == null ? '' : s).replace(/[,\s원₩]/g, ''); if (!t) return null; var neg = /^\(.*\)$/.test(t); t = t.replace(/[()]/g, ''); var n = +t; return isFinite(n) ? (neg ? -n : n) : NaN; }
function vatSupIn(){ var t = $('vf_tax'); if (t.dataset.touched) return; var s = vatParse($('vf_sup').value); t.value = s != null && !isNaN(s) ? vW(Math.round(s * 0.1)) : ''; }
function vatSave(){
  var d = $('vf_d').value, sup = vatParse($('vf_sup').value), tax = vatParse($('vf_tax').value), biz = vBiz($('vf_biz').value), nm = $('vf_nm').value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)){ toast('날짜를 넣어 주세요'); return; }
  if (sup == null || isNaN(sup)){ toast('공급가액을 숫자로 넣어 주세요'); return; }
  if (tax == null) tax = Math.round(sup * 0.1); if (isNaN(tax)){ toast('세액을 숫자로 넣어 주세요'); return; }
  if (!nm){ toast('거래처를 넣어 주세요'); return; }
  if (biz && biz.length !== 10 && !confirm('사업자번호가 10자리가 아닙니다 (' + biz + '). 그대로 저장할까요?')) return;
  if (tax && Math.abs(tax - Math.round(sup * 0.1)) > 10 && !confirm('세액 ' + vW(tax) + ' 이 공급가액의 10%(' + vW(Math.round(sup * 0.1)) + ')와 다릅니다. 그대로 저장할까요?')) return;
  var rec = { d: d, dir: $('vf_dir').value, k: $('vf_k').value, nm: nm.slice(0, 80), biz: biz || null, sup: sup, tax: tax, memo: $('vf_memo').value.trim().slice(0, 200) || null, ded: $('vf_ded').checked ? null : false, by: (me && me.email) || '' };
  var p = VAT_EDIT && VMAN[VAT_EDIT] ? db.ref('settlement/vat/man/' + VAT_EDIT).update(rec) : db.ref('settlement/vat/man').push(Object.assign(rec, { at: firebase.database.ServerValue.TIMESTAMP }));
  p.then(function(){ toast('✔ 저장 — ' + nm + ' ' + vW(sup)); VAT_EDIT = null; if (document.activeElement) document.activeElement.blur(); renderVat(); })
    .catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); });
}
function vatDelMan(id){ var m = VMAN[id]; if (!m || !confirm('「' + m.d + ' ' + (m.nm || '') + ' ' + vW(m.sup) + '」 줄을 지울까요?')) return; db.ref('settlement/vat/man/' + id).set(null); }
function vatDelFile(f){ var F = VFILES[f]; if (!F || !confirm('「' + F.name + '」 자료를 지울까요?\n\n이 파일에서 들어온 매출·매입 줄도 같이 빠집니다.')) return;
  var u = {}; u['files/' + f] = null; u['rows/' + f] = null; db.ref('settlement/vat').update(u).then(function(){ toast('지웠습니다'); }); }

/* ═══ 자료 판별·읽기 ═══ */
function vatH(s){ return String(s == null ? '' : s).replace(/[\s ]/g, '').replace(/\(.*?\)/g, ''); }
function vatDate(v){
  if (typeof v === 'number' && v > 20000 && v < 80000 && XLSX.SSF){ var o = XLSX.SSF.parse_date_code(v); if (o) return o.y + '-' + String(o.m).padStart(2, '0') + '-' + String(o.d).padStart(2, '0'); }
  var s = String(v == null ? '' : v).trim(), m = s.match(/^(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null; var y = +m[1], mo = +m[2], d = +m[3]; if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function vatNum(v){ if (typeof v === 'number') return v; var n = vatParse(v); return n == null || isNaN(n) ? 0 : n; }
var VAT_HEADS = ['작성일자','승인일자','거래일자','거래일시','매출일시','이용일자','사용일자','발행일자','승인일시','승인번호','공급가액','세액','부가세','부가가치세','합계금액','합계','총금액','승인금액','이용금액',
  '카드번호','카드사','가맹점명','가맹점사업자번호','공급자사업자등록번호','공급받는자사업자등록번호','상호','공제여부','거래구분','승인구분','품목명','비고','봉사료','사업자번호','사업자등록번호'];
function vatCols(H){
  var f = function(names, from){ for (var j = 0; j < names.length; j++){ var i = H.indexOf(names[j], from || 0); if (i >= 0) return i; } return -1; };
  var c = {
    date: f(['작성일자','승인일자','거래일자','거래일시','매출일시','이용일자','사용일자','발행일자','승인일시','일자','날짜']),
    no: f(['승인번호']), sup: f(['공급가액']), tax: f(['세액','부가세','부가가치세','부가세액']), tot: f(['합계금액','합계','총금액','승인금액','이용금액','거래금액']),
    card: f(['카드번호','카드사','카드종류','카드구분']), mer: f(['가맹점명','가맹점상호','가맹점']), merBiz: f(['가맹점사업자번호','가맹점사업자등록번호']),
    ded: f(['공제여부결정','공제여부','매입세액공제여부','공제구분']), cancel: f(['거래구분','승인구분','취소여부']),
    sB: f(['공급자사업자등록번호','공급자등록번호']), bB: f(['공급받는자사업자등록번호','공급받는자등록번호']), item: f(['품목명'])
  };
  if (c.merBiz < 0 && c.mer >= 0) c.merBiz = f(['사업자번호','사업자등록번호']);
  if (c.sB >= 0 && c.bB >= 0){ c.sNm = H.indexOf('상호', c.sB); if (c.sNm > c.bB) c.sNm = -1; c.bNm = H.indexOf('상호', c.bB); }
  return c;
}
/* 엑셀 한 개 → 시트마다 { ok, kind, rows, ... } 또는 { ok:false, reason, cand } */
function vatRead(name, buf){
  var ext = (name.split('.').pop() || '').toLowerCase(), wb;
  if (ext === 'csv'){ var txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('euc-kr').decode(buf); } wb = XLSX.read(txt, { type: 'string', raw: true }); }
  else wb = XLSX.read(buf, { type: 'array' });
  var out = [];
  wb.SheetNames.forEach(function(sn){
    var ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) return;
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
    var hi = -1, best = 0;
    for (var i = 0; i < Math.min(aoa.length, 25); i++){ var sc = 0; aoa[i].forEach(function(v){ if (VAT_HEADS.indexOf(vatH(v)) >= 0) sc++; }); if (sc > best){ best = sc; hi = i; } }
    if (best < 3) return;   /* 안내 시트 등 */
    var H = aoa[hi].map(vatH), title = name + ' ' + sn + ' ' + aoa.slice(0, hi).map(function(r){ return r.join(' '); }).join(' ');
    out.push(vatParseSheet({ name: name, sheet: sn, aoa: aoa, hi: hi, H: H, c: vatCols(H), title: title }, null));
  });
  if (!out.length) out.push({ ok: false, name: name, reason: '부가세 자료 열 머리글(작성일자·승인번호·공급가액·세액…)을 찾지 못했습니다', heads: [] });
  return out;
}
/* force = 대표님이 고른 종류 (card_buy · cash_buy · cash_sale · tax_sale · tax_buy) */
function vatParseSheet(X, force){
  var c = X.c, H = X.H, title = X.title, our = vatOur(), heads = H.filter(Boolean);
  var fail = function(reason, cand){ return { ok: false, name: X.name, sheet: X.sheet, reason: reason, heads: heads, cand: cand || [], X: X }; };
  if (c.date < 0) return fail('날짜 칸(작성일자·승인일자·거래일자…)이 없습니다');
  if (c.sup < 0) return fail('공급가액 칸이 없습니다 — 금액을 공급가액·세액으로 나누지 않고는 반영하지 않습니다');
  var kind, dirF = null;
  if (force){ kind = force.split('_')[0]; dirF = force.split('_')[1]; }
  else if (c.sB >= 0 && c.bB >= 0) kind = 'tax';
  else if (c.card >= 0) kind = 'card';
  else if (/현금영수증/.test(title) || heads.some(function(h){ return /현금영수증/.test(h); })) kind = 'cash';
  else return fail('세금계산서·카드·현금영수증 중 어느 자료인지 열 머리글로 알 수 없습니다', c.mer >= 0 ? ['card_buy', 'cash_buy'] : ['cash_sale', 'card_buy', 'cash_buy']);
  if (c.tax < 0 && kind !== 'tax') return fail('세액(부가세) 칸이 없습니다 — 추정해서 나누지 않습니다');
  if (!dirF){
    if (kind === 'card' || kind === 'cash'){
      if (c.mer >= 0) dirF = 'buy';
      else if (kind === 'cash' && /매출/.test(title) && !/매입/.test(title)) dirF = 'sale';
      else return fail((kind === 'card' ? '카드' : '현금영수증') + ' 자료인데 매출인지 매입인지 알 수 없습니다 (가맹점 칸 없음)', kind === 'card' ? ['card_buy'] : ['cash_buy', 'cash_sale']);
    }
  }
  var rows = [], warn = [], info = [], noDate = 0, notOur = 0, mism = [], cancel = 0, nod = 0, mixed = {};
  for (var i = X.hi + 1; i < X.aoa.length; i++){
    var r = X.aoa[i]; if (!r || !r.some(function(v){ return v !== '' && v != null; })) continue;
    var d = vatDate(r[c.date]), sup = vatNum(r[c.sup]), tax = c.tax >= 0 ? vatNum(r[c.tax]) : 0;
    if (!d){ var lab = r.slice(0, 4).join(''); if ((sup || tax) && !/합계|소계|총계|계$/.test(lab)) noDate++; continue; }
    var o = { d: d, k: kind, sup: Math.round(sup), tax: Math.round(tax), no: c.no >= 0 ? String(r[c.no]).trim().slice(0, 40) : '' };
    if (kind === 'tax'){
      var sb = vBiz(r[c.sB]), bb = vBiz(r[c.bB]);
      if (dirF){ o.dir = dirF; } else if (sb === our && bb !== our) o.dir = 'sale'; else if (bb === our && sb !== our) o.dir = 'buy'; else { notOur++; continue; }
      if (o.dir === 'sale'){ o.biz = bb; o.nm = c.bNm >= 0 ? String(r[c.bNm]).trim() : ''; } else { o.biz = sb; o.nm = c.sNm >= 0 ? String(r[c.sNm]).trim() : ''; }
      mixed[o.dir] = 1;
    } else {
      o.dir = dirF; o.nm = c.mer >= 0 ? String(r[c.mer]).trim() : ''; o.biz = c.merBiz >= 0 ? vBiz(r[c.merBiz]) : '';
      if (c.cancel >= 0 && /취소/.test(String(r[c.cancel])) && o.sup > 0){ o.sup = -o.sup; o.tax = -o.tax; cancel++; }
    }
    if (c.ded >= 0){ var dv = String(r[c.ded]).trim(); if (/불공제|^N$|^아니/i.test(dv)){ o.ded = false; nod++; } }
    if (o.tax && Math.abs(o.tax - Math.round(o.sup * 0.1)) > 10) mism.push(d.slice(5) + ' ' + o.nm + ' 공급 ' + vW(o.sup) + '/세액 ' + vW(o.tax));
    o.nm = o.nm.slice(0, 80); if (!o.no) delete o.no; if (!o.biz) delete o.biz; if (o.ded == null) delete o.ded;
    rows.push(o);
  }
  if (kind === 'tax' && !rows.length && notOur) return fail('세금계산서 목록인데 공급자·공급받는자 어디에도 우리 사업자번호(' + vBizF(our) + ')가 없습니다 — 다른 회사 자료?', ['tax_sale', 'tax_buy']);
  if (!rows.length) return fail('읽을 줄(날짜가 있는 줄)이 없습니다');
  if (notOur) warn.push('우리 사업자번호가 없는 줄 ' + notOur + '건은 뺐습니다');
  if (noDate) warn.push('날짜를 못 읽은 금액 줄 ' + noDate + '건은 뺐습니다');
  if (mism.length) warn.push('세액이 공급가액의 10%와 다른 줄 ' + mism.length + '건 (그대로 반영): ' + mism.slice(0, 4).join(', ') + (mism.length > 4 ? ' …' : ''));
  if (kind === 'tax' && c.tax < 0) info.push('세액 칸 없음 → 면세 계산서로 세액 0');
  if (cancel) info.push('취소 거래 ' + cancel + '건은 − 로 반영');
  if (nod) info.push('불공제 ' + nod + '건은 매입세액에서 뺌');
  if (force) info.push('종류 직접 고름: ' + force);
  return { ok: true, name: X.name, sheet: X.sheet, kind: kind, rows: rows, warn: warn, info: info };
}
function vatKey(r){ return r.k === 'tax' && r.no ? 'T' + r.no : [r.k, r.dir, r.d, r.no || '', r.biz || '', r.nm, r.sup, r.tax].join('|'); }
function vatSaveParsed(R){
  var have = {}; Object.keys(VROWS).forEach(function(f){ if (!VFILES[f]) return; (VROWS[f] || []).forEach(function(r){ if (r) have[vatKey(r)] = 1; }); });
  var seen = {}, rows = [], dup = 0;
  R.rows.forEach(function(r){ var k = vatKey(r); if (have[k] || (r.k === 'tax' && r.no && seen[k])){ dup++; return; } seen[k] = 1; rows.push(r); });
  if (!rows.length){ VAT_PEND.push({ name: R.name, sheet: R.sheet, reason: '이미 올린 자료와 같은 거래뿐입니다 (' + dup + '건 모두 중복) — 새로 넣은 것 없음', heads: [] }); renderVat(); return Promise.resolve(); }
  var sum = function(dir){ var s = { n: 0, sup: 0, tax: 0 }; rows.forEach(function(r){ if (r.dir !== dir) return; s.n++; s.sup += r.sup; s.tax += r.tax; }); return s.n ? s : null; };
  var ds = rows.map(function(r){ return r.d; }).sort(), info = R.info.slice(); if (dup) info.push('이미 올린 거래 ' + dup + '건은 건너뜀');
  var fid = db.ref('settlement/vat/files').push().key, u = {};
  u['files/' + fid] = { name: R.name.slice(0, 120), sheet: R.sheet || null, kind: R.kind, n: rows.length, dup: dup || null, from: ds[0], to: ds[ds.length - 1], sale: sum('sale'), buy: sum('buy'),
    warn: R.warn.length ? R.warn : null, info: info.length ? info : null, at: firebase.database.ServerValue.TIMESTAMP, by: (me && me.email) || '' };
  u['rows/' + fid] = rows;
  return db.ref('settlement/vat').update(u).then(function(){ toast('📥 ' + R.name + ' — ' + VK_LB[R.kind] + ' ' + rows.length + '건 반영' + (dup ? ' (중복 ' + dup + '건 건너뜀)' : '')); });
}
function vatFiles(list){
  Array.prototype.reduce.call(list, function(p, file){
    return p.then(function(){ return file.arrayBuffer(); }).then(function(buf){
      if (typeof vcTryFile === 'function' && vcTryFile(file.name, buf)) return;   /* 마감집계 엑셀이면 📋 마감집계로 */
      var res; try { res = vatRead(file.name, buf); } catch (e) { res = [{ ok: false, name: file.name, reason: '파일을 열지 못했습니다 (' + ((e && e.message) || e) + ')', heads: [] }]; }
      return res.reduce(function(q, R){ return q.then(function(){ if (!R.ok){ VAT_PEND.push(R); renderVat(); return; } return vatSaveParsed(R); }); }, Promise.resolve());
    }).catch(function(e){ VAT_PEND.push({ name: file.name, reason: '올리기 실패: ' + ((e && (e.code || e.message)) || e), heads: [] }); renderVat(); });
  }, Promise.resolve());
}
/* 특이사항에서 종류를 직접 고르면 그 종류로 다시 읽어 반영 */
function vatPick(i, kind){
  var P = VAT_PEND[i]; if (!P || !kind || !P.X) return;
  var R = vatParseSheet(P.X, kind);
  if (!R.ok){ P.reason = R.reason; renderVat(); return; }
  VAT_PEND.splice(i, 1);
  vatSaveParsed(R).then(renderVat);
}
