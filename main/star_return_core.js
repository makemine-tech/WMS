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
    if (n.found && n.found.rno !== r.rno) return;   /* 다른 반품에서 이미 찾은 특이사항 */
    if (n.kind === 'inv' && keys.indexOf(n.val) >= 0) out.push({ k: k, t: '송장', n: n });
    if (n.kind === 'item' && codes[n.val]) out.push({ k: k, t: '상품', n: n }); });
  return out;
}
/* 사전 특이사항: 찾을 때까지 날짜 상관없이 「대기 중」 → 스캔으로 맞으면 「찾음」으로 넘김 (대표님 2026-10-24) */
function markNotes(r){
  noteHits(r).forEach(function(h){ if (h.n.found) return;
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
  if ((r.extras || []).length) info.push('반품 대상 아닌 상품 ' + r.extras.reduce(function(s, x){ return s + x.n; }, 0) + '개');
  (r.items || []).forEach(function(it){ if (it.got > it.qty) info.push('주문보다 많음: ' + it.name); });
  if ((r.items || []).some(function(it){ return it.got > 0 && it.got < it.qty; }) || ((r.items || []).some(function(it){ return !it.got; }) && (r.items || []).some(function(it){ return it.got > 0; }))) info.push('부분 반품');
  if (r.self) info.push('반송 (원송장 = 반품송장)');
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
    (r.items || []).forEach(function(it){ if (n > 0 && it.nicn && (it.nicn === x.code || (digits(it.nicn) && digits(it.nicn) === digits(x.code) && digits(x.code).length >= 8))){ it.got = (it.got || 0) + n; n = 0; if (x.q === '2') it.q = '2'; } });
    if (n > 0) left.push(x.q ? { code: x.code, n: n, q: x.q } : { code: x.code, n: n });
  });
  r.extras = left;
}
function locked(r){ return r.state === 'done' || r.state === 'saving'; }

/* 상품 바코드 한 번 스캔 → 주문 상품이면 반품 수량 +1, 아니면 「반품 대상 아닌 상품」 (r 을 바꿈)
   돌려줌 { hit: 맞은 상품 줄 | null, over: 주문보다 많아짐, code, note: 사전 특이사항(상품) } */
function applyItem(r, code){
  var c2 = String(code || '').replace(/\s+/g, ''), hit = null;
  var hits = (r.items || []).filter(function(it){ return it.nicn && (it.nicn === c2 || digits(it.nicn) && digits(it.nicn) === digits(c2) && digits(c2).length >= 8); });
  if (hits.length){
    hit = hits.filter(function(x){ return x.got < x.qty; })[0] || hits[hits.length - 1];
    hit.got = (hit.got || 0) + 1;
  } else {
    r.extras = r.extras || [];
    var x = r.extras.filter(function(e){ return e.code === c2; })[0];
    if (x) x.n++; else r.extras.push({ code: c2, n: 1 });
  }
  var note = Object.keys(NOTES).map(function(k){ return NOTES[k]; }).filter(function(n){ return n && n.kind === 'item' && n.val === c2 && (!n.found || n.found.rno === r.rno); })[0] || null;
  return { hit: hit, over: !!(hit && hit.got > hit.qty), code: c2, note: note };
}
