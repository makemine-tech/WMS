/* ============================================================
   스타 3PL 반품입고 — PC(star_return.html)·휴대폰(star_return_m.html) 공통 판정 (2026-10-24)
   두 화면이 같은 기록(wms_sync/groups/{gid}/star_return)을 보므로 판정 규칙은 여기 한 곳에서만 고친다.
   쓰는 전역(각 화면이 정의): NOTES, base, byName(), toast()
============================================================ */
var STAR_CUST = '446';   /* 이벗 고객사 — 스타인터내셔널 */

/* 같은 화면을 두 가지 반품 데이터로 씀 (대표님 2026-10-24)
   - 스타(기본): 피킹 화면에서 들어옴. 모든 반품 송장을 우체국 추적, 스타인터내셔널(446)만 반영
   - 화물(?db=cargo): 화물관리에서 들어옴. 한진·롯데 등 다른 택배도 많아 우체국 송장(6077·7077)만 추적,
     나머지는 원송장 없이 쌓였다가 사진 등으로 원송장을 찾아 ✏️ 수정에 넣으면 이벗 조회·반영. 업체명·택배사 선택. 고객사 제한 없음 */
var CFG = /[?&]db=cargo(&|$)/.test(location.search)
  ? { db: 'cargo', path: 'cargo_return', title: '3PL 반품입고관리', badge: 'CARGO 3PL RETURN', cust: null, traceAll: false, vendor: true, back: 'cargo_log.html', backLabel: '화물관리로', q: '&db=cargo' }
  : { db: 'star', path: 'star_return', title: '스타 3PL 반품입고관리', badge: 'STAR 3PL RETURN', cust: STAR_CUST, traceAll: true, vendor: false, back: 'star_picking.html', backLabel: '피킹으로', q: '' };
var COURIERS = ['우체국', '한진', '롯데', 'CJ대한통운', '로젠', '기타'];
/* 송장번호 자리수는 택배사마다 달라 정하지 않음 (대표님 2026-10-24) — 숫자가 있기만 하면, 너무 긴 것(30자리 넘음)만 막음 */
function okNo(no){ return !!no && no.length <= 30; }
function isEpost(no){ return /^(6077|7077)/.test(String(no || '')); }
function needTrace(no){ return CFG.traceAll || isEpost(no); }
function custOK(o){ return !CFG.cust || o.cust === CFG.cust; }
function vkey(name){ return String(name || '').replace(/[.#$\[\]\/]/g, '_'); }

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
function digits(v){ return String(v == null ? '' : v).replace(/\D/g, ''); }
function pad(n){ return String(n).padStart(2, '0'); }
function dayOf(ts){ var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hm(ts){ var d = new Date(ts); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
var actx = null;
function beep(ok){ try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); var o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = ok ? 1046 : 220; o.type = ok ? 'sine' : 'square'; g.gain.value = .08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? .09 : .35)); } catch(e){} }

/* ── 판정 ── */
function starOrders(r){ return (r.orders || []).filter(custOK); }   /* 반영 대상 주문 (스타면 446만, 화물이면 전부) */
function rmanOf(r){ return r.rmanEdit || starOrders(r).map(function(o){ return o.rman; }).filter(function(v, i, a){ return v && a.indexOf(v) === i; }).join(', '); }
function noteHits(r){
  var out = [], keys = [r.rno, r.orig].filter(Boolean), codes = {};
  (r.items || []).forEach(function(it){ if (it.got > 0 && it.nicn) codes[it.nicn] = 1; });
  (r.extras || []).forEach(function(x){ codes[x.code] = 1; });
  Object.keys(NOTES).forEach(function(k){ var n = NOTES[k]; if (!n) return;
    /* 업체(화물): 그 업체 반품마다 늘 안내 — 「찾음」으로 넘기지 않음 */
    if (n.kind === 'vendor'){ if (r.vendor && String(n.val || '').replace(/\s/g, '') === String(r.vendor).replace(/\s/g, '')) out.push({ k: k, t: '업체', n: n }); return; }
    if (n.found && n.found.rno !== r.rno) return;   /* 다른 반품에서 이미 찾은 특이사항 */
    if (n.kind === 'inv' && keys.indexOf(n.val) >= 0) out.push({ k: k, t: '송장', n: n });
    if (n.kind === 'item' && codes[n.val]) out.push({ k: k, t: '상품', n: n }); });
  return out;
}
/* 사전 특이사항: 찾을 때까지 날짜 상관없이 「대기 중」 → 스캔으로 맞으면 「찾음」으로 넘김 (대표님 2026-10-24) */
function markNotes(r){
  noteHits(r).forEach(function(h){ if (h.n.found || h.t === '업체') return;
    h.n.found = { rno: r.rno, at: Date.now(), by: byName(), how: h.t };
    base.child('notes/' + h.k + '/found').set(h.n.found);
    toast('📌 사전 특이사항 ' + h.t + '을 찾았습니다 — ' + (h.n.memo || h.n.val)); beep(false); });
}
/* 막힘(이벗에 못 넣음) / 알림(넣되 확인) */
function judge(r){
  var block = [], info = [];
  if (CFG.vendor && !r.vendor) block.push('업체명 없음');
  if (CFG.db === 'cargo' && !r.courier) block.push('택배사 미선택');
  if (r.trace === 'skip' && !r.orig) block.push('원송장 없음 — 찾아서 ✏️ 수정에 입력');
  else if (r.trace === 'err') block.push('원송장 조회 실패');
  else if (r.trace === 'busy') block.push('원송장 조회 중');
  else if (r.look === 'wait' || r.look === 'busy') block.push('이벗 주문 조회 대기');
  else if (r.look === 'err') block.push('이벗 주문 조회 실패');
  else if (r.look === 'none') block.push('이벗에서 원송장 주문 못 찾음');
  else if (r.look === 'ok'){
    var st = starOrders(r);
    if (!st.length) block.push('다른 고객사 주문 (' + (r.orders || []).map(function(o){ return o.custName || o.cust; }).filter(function(v, i, a){ return a.indexOf(v) === i; }).join(', ') + ')');
    else if (!(r.items || []).length && st.every(function(o){ return o.ret !== '-'; })) block.push('이벗에서 이미 반품처리됨 (' + st.map(function(o){ return o.ret; }).join(',') + ')');
    else if (!(r.items || []).some(function(it){ return it.got > 0; })) block.push('반품 상품 스캔 없음');
  }
  if ((r.extras || []).length) info.push((CFG.db === 'cargo' && !(r.items || []).length ? '원송장 전 스캔 상품 ' : '반품 대상 아닌 상품 ') + r.extras.reduce(function(s, x){ return s + x.n; }, 0) + '개');
  (r.items || []).forEach(function(it){ if (it.got > it.qty) info.push('주문보다 많음: ' + it.name); });
  (r.items || []).forEach(function(it){ if (isMix(it)) info.push('정상·불량 섞임: ' + it.name + ' (정상 ' + goodOf(it) + ' · 불량 ' + badOf(it) + ') — 이벗은 손으로 나눠 입력'); });
  if ((r.items || []).some(function(it){ return it.got > 0 && it.got < it.qty; }) || ((r.items || []).some(function(it){ return !it.got; }) && (r.items || []).some(function(it){ return it.got > 0; }))) info.push('부분 반품');
  if (r.self) info.push('반송 (원송장 = 반품송장)');
  if (r.reco && r.reco !== '401') info.push('반품사유 ' + recoName(r.reco));
  if (r.checked && r.state === 'scan') info.push('검수 완료 · 반영 전');
  noteHits(r).forEach(function(h){ info.push('📌 사전 특이사항 ' + h.t + ': ' + (h.n.memo || h.n.val)); });
  if (r.memo) info.push('메모: ' + r.memo);
  return { block: block, info: info };
}
function stOf(r){
  if (r.state === 'saving' && Date.now() - (r.saveAt || 0) > 120000) return { k: 'fail', t: '확인 필요' };
  if (r.state === 'done') return { k: 'done', t: r.ebut && r.ebut.mode === 'manual' ? '수동 완료' : '자동 완료' };
  return { scan: { k: 'scan', t: '검수 중' }, ready: { k: 'ready', t: '반영 대기' }, saving: { k: 'saving', t: '반영 중' }, fail: { k: 'fail', t: '반영 실패' } }[r.state] || { k: 'scan', t: '검수 중' };
}
/* 이벗에서 상품 목록을 받아 오면, 그 전에 「주문에 없는 상품」으로 쌓아 둔 바코드 중 맞는 것을 상품 수량으로 옮김
   (화물 반품은 원송장을 나중에 찾으므로 상품을 먼저 스캔해 두는 경우가 많음) */
function absorbExtras(r){
  var left = [];
  (r.extras || []).forEach(function(x){
    var n = x.n;
    (r.items || []).forEach(function(it){ if (n > 0 && ((it.nicn && x.code && (it.nicn === x.code || (digits(it.nicn) && digits(it.nicn) === digits(x.code) && digits(x.code).length >= 8)))
        || (!x.code && x.name && String(it.name || '').replace(/\s/g, '') === String(x.name).replace(/\s/g, '')))){   /* 직접 입력은 상품명이 같으면 */
      var b = badOf(it) + badOf(x); it.got = (it.got || 0) + n; n = 0; setBad(it, b); } });
    if (n > 0) left.push(x);
  });
  r.extras = left;
}
/* 정상·불량 수량 (대표님 2026-10-24) — 한 상품 줄 안에서도 정상·불량이 나뉠 수 있음: got = 반품 온 수량, bad = 그중 불량
   예전 기록(bad 없음)은 q '2' = 전부 불량. q 는 이벗 도우미·예전 화면용으로 같이 맞춰 둠 ('1' 전부 정상 · '2' 전부 불량 · 'mix' 섞임)
   상품 줄(got)·반품 대상 아닌 상품(n) 둘 다 씀 */
function cntOf(o){ return (o.got != null ? o.got : o.n) || 0; }
function badOf(o){ var n = cntOf(o); return o.bad != null ? Math.max(0, Math.min(n, o.bad || 0)) : (o.q === '2' ? n : 0); }
function goodOf(o){ return cntOf(o) - badOf(o); }
function setBad(o, b){ var n = cntOf(o); o.bad = Math.max(0, Math.min(n, b || 0)); o.q = !o.bad ? '1' : o.bad >= n ? '2' : 'mix'; }
function isMix(o){ var b = badOf(o); return b > 0 && b < cntOf(o); }
function xName(x){ return x.name || x.code || ''; }   /* 반품 대상 아닌·먼저 넣은 상품: 휴대폰 직접 입력은 바코드 없이 이름만 */
/* 반품사유 (이벗 RETURN_RECO) — 휴대폰에서 고름, 기본 고객변심. 안 고른 예전 기록은 도우미가 불량 있으면 상품불량 */
var RECOS = [['401', '고객변심'], ['402', '상품불량'], ['403', '오배송'], ['404', '기타']];
function recoName(c){ var x = RECOS.filter(function(r){ return r[0] === c; })[0]; return x ? x[1] : ''; }
function qText(o){ return isMix(o) ? '정상 ' + goodOf(o) + ' · 불량 ' + badOf(o) : badOf(o) ? '불량' : '정상'; }   /* 엑셀·PDF 칸 */
/* 수량 바꾸기: 정상(kind '1') 또는 불량(kind '2') 을 d 만큼 — 반품 수량(got/n)도 같이 바뀜 */
function addCnt(o, kind, d){
  var b = badOf(o), g = cntOf(o) - b;
  if (kind === '2') b = Math.max(0, b + d); else g = Math.max(0, g + d);
  if (o.got != null || o.n == null) o.got = g + b; else o.n = g + b;
  setBad(o, b);
}
function locked(r){ return r.state === 'done' || r.state === 'saving'; }

/* 상품 바코드 한 번 스캔 → 주문 상품이면 반품 수량 +1, 아니면 「반품 대상 아닌 상품」 (r 을 바꿈)
   q = '2' 면 불량으로 셈 (휴대폰 「불량으로 찍기」), 없으면 정상
   돌려줌 { hit: 맞은 상품 줄 | null, over: 주문보다 많아짐, code, note: 사전 특이사항(상품) } */
function applyItem(r, code, q){
  var c2 = String(code || '').replace(/\s+/g, ''), hit = null;
  var hits = (r.items || []).filter(function(it){ return it.nicn && (it.nicn === c2 || digits(it.nicn) && digits(it.nicn) === digits(c2) && digits(c2).length >= 8); });
  if (hits.length){
    hit = hits.filter(function(x){ return x.got < x.qty; })[0] || hits[hits.length - 1];
    if (hit.got == null) hit.got = 0;
    addCnt(hit, q === '2' ? '2' : '1', 1);
  } else {
    r.extras = r.extras || [];
    var x = r.extras.filter(function(e){ return e.code === c2; })[0];
    if (!x){ x = { code: c2, n: 0 }; r.extras.push(x); }
    addCnt(x, q === '2' ? '2' : '1', 1);
  }
  var note = Object.keys(NOTES).map(function(k){ return NOTES[k]; }).filter(function(n){ return n && n.kind === 'item' && n.val === c2 && (!n.found || n.found.rno === r.rno); })[0] || null;
  return { hit: hit, over: !!(hit && hit.got > hit.qty), code: c2, note: note };
}
