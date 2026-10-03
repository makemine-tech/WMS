/* ============================================================
   정산관리 — 브론테 정산서(업체가 보내오는 PDF) 크로스체크 (2026-10-03 대표님)
   브론테 = (주)비플랜트, 받을 돈. 우리가 정산서를 만드는 게 아니라 브론테 PDF 가 맞는지만 확인.
   파일함의 「브론테 정산서」 줄 → 🔍 이벗과 대조:
     PDF 글자를 읽어(pdf.js) 상품 줄(상품명·총판매수량·판매가·수수료율·총거래액·총공급가·총수수료)·배송비·최종 합계를 뽑고
     이번 달 이벗 전체주문목록의 판매처 「…브론테」 주문(캔 수 = 매칭수량, 송장 수)과 비교:
       ① 캔 수  PDF Σ(수량 × 상품명 N캔) = 이벗 캔 합계
       ② 공급가 검산  Σ 총거래액 × (1 − 수수료율) = Σ 총공급가
       ③ 배송비  = 송장 수 × 3,000
       ④ 받을 돈 = 공급가 + 배송비 (VAT 포함) = PDF 마지막 합계
   쓰는 전역: BOX, YM, decryptBox(settle_build.js), esc, won, toast, ymLabel
============================================================ */
var BRONTE_SHIP = 3000, BRONTE_SELLER = /브론테/;

function loadPdfJs(){
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise(function(ok, no){
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = function(){ window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = function(){ no(new Error('pdf.js 를 불러오지 못했습니다')); }; document.head.appendChild(s);
  });
}
/* PDF → 줄(같은 높이 글자를 왼쪽부터 이어 붙임) */
function pdfLines(bytes){
  return loadPdfJs().then(function(lib){ return lib.getDocument({ data: bytes }).promise; }).then(function(doc){
    var pages = []; for (var i = 1; i <= doc.numPages; i++) pages.push(i);
    return Promise.all(pages.map(function(n){ return doc.getPage(n).then(function(p){ return p.getTextContent(); }).then(function(tc){
      var rows = {}; tc.items.forEach(function(it){ var y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str }); });
      return Object.keys(rows).sort(function(a, b){ return b - a; }).map(function(y){ return rows[y].sort(function(a, b){ return a.x - b.x; }).map(function(t){ return t.s; }).join(' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    }); })).then(function(a){ return [].concat.apply([], a); });
  });
}
var bnum = function(s){ return +String(s).replace(/[₩,)\s]/g, '') || 0; };
function parseBronte(lines){
  var items = [], ship = null, total = null, month = '';
  lines.forEach(function(L){
    var mm = L.match(/매출월.*?(\d{4}-\d{2})/); if (mm) month = mm[1];
    var nums = L.match(/[\d,]+(?=\s|$)/g) || [];
    if (/캔/.test(L) && nums.length >= 6 && !/총 거래액/.test(L)){
      var n6 = nums.slice(-6).map(bnum), name = L.replace(/(\s+[\d,]+){6}\s*$/, '').trim();
      var can = (name.match(/(\d+)\s*캔/) || [])[1];
      items.push({ name: name, qty: n6[0], price: n6[1], rate: n6[2], gross: n6[3], supply: n6[4], fee: n6[5], cans: can ? +can * n6[0] : null });
    }
    if (/^배송비/.test(L) && nums.length) ship = bnum(nums[0]);
    if (/상품\+배송비/.test(L) && nums.length >= 2){ var all = nums.map(bnum); total = { gross: all[0], supply: all[all.length - 2], fee: all[all.length - 1] }; }
  });
  return { items: items, ship: ship, total: total, month: month };
}
function bronteOrders(){
  var ids = Object.keys(BOX).filter(function(id){ return BOX[id].type === 'ebut_orders'; });
  var seen = {}, out = { rows: [], cans: 0, inv: {} };
  return ids.reduce(function(p, id){ return p.then(function(){ return decryptBox(BOX[id]).then(function(b){
    var wb = XLSX.read(b, { type: 'array' }), a = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); if (!a.length) return;
    var H = a[0].map(function(h){ return String(h).replace(/\s/g, ''); }), c = function(n){ return H.indexOf(n); };
    var iS = c('판매처'), iN = c('송장번호'), iM = c('매칭수량'), iQ = c('수량'), iP = c('상품명'), iD = c('등록일');
    a.slice(1).forEach(function(r){ if (!BRONTE_SELLER.test(String(r[iS]))) return; var k = r.join('\u0001'); if (seen[k]) return; seen[k] = 1;
      var n = +r[iM] > 0 ? +r[iM] : ((String(r[iP]).match(/(\d+)\s*(캔|개)/) || [])[1] && !/---/.test(r[iP]) ? +(String(r[iP]).match(/(\d+)\s*(캔|개)/))[1] * (+r[iQ] || 1) : (+r[iQ] || 0));
      out.rows.push({ d: String(r[iD]).slice(0, 10), name: r[iP], q: r[iQ], cans: n, inv: String(r[iN] || '').trim() }); out.cans += n; if (r[iN]) out.inv[String(r[iN]).trim()] = 1; });
  }); }); }, Promise.resolve()).then(function(){ out.nInv = Object.keys(out.inv).length; return out; });
}
function bronteCheck(id){
  var m = BOX[id]; if (!m) return;
  var ov = document.getElementById('bronteOv'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'bronteOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:860px;width:100%;margin:0"><div class="card-h"><span class="card-t">🧾 브론테 정산서 대조 — ' + esc(ymLabel(YM)) + '</span><button class="btn" style="margin-left:auto" onclick="document.getElementById(\'bronteOv\').remove()">닫기</button></div><div id="bronteBody" class="sm">PDF 읽는 중…</div></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
  var body = function(h){ var b = document.getElementById('bronteBody'); if (b) b.innerHTML = h; };
  Promise.all([decryptBox(m).then(pdfLines), bronteOrders()]).then(function(r){
    var P = parseBronte(r[0]), O = r[1];
    var sGross = P.items.reduce(function(s, x){ return s + x.gross; }, 0), sSup = P.items.reduce(function(s, x){ return s + x.supply; }, 0);
    var pCans = P.items.reduce(function(s, x){ return s + (x.cans || 0); }, 0), calcSup = P.items.reduce(function(s, x){ return s + Math.round(x.gross * (1 - x.rate / 100)); }, 0);
    var expShip = O.nInv * BRONTE_SHIP, recv = sSup + (P.ship || 0), ok = function(b){ return b ? '<b style="color:var(--g)">✔ 맞음</b>' : '<b style="color:#f87171">✘ 다름</b>'; };
    var chk = [
      ['① 캔 수', 'PDF ' + pCans + '캔 (' + P.items.map(function(x){ return x.name + ' × ' + x.qty; }).join(', ') + ')', '이벗 ' + O.cans + '캔 (' + O.rows.length + '줄)', pCans === O.cans],
      ['② 공급가 검산', '총거래액 ' + won(sGross) + ' × (1 − 수수료율) = ' + won(calcSup), 'PDF 총공급가 ' + won(sSup), Math.abs(calcSup - sSup) <= P.items.length],
      ['③ 배송비', 'PDF ' + won(P.ship || 0), '이벗 송장 ' + O.nInv + '건 × ' + won(BRONTE_SHIP) + ' = ' + won(expShip), (P.ship || 0) === expShip],
      ['④ 받을 돈 (VAT 포함)', '공급가 ' + won(sSup) + ' + 배송비 ' + won(P.ship || 0) + ' = ' + won(recv), 'PDF 마지막 합계 ' + (P.total ? won(P.total.supply) : '?'), !!P.total && P.total.supply === recv]
    ];
    var allOk = chk.every(function(c){ return c[3]; });
    body((P.month && P.month !== YM ? '<div class="chk warn" style="margin-bottom:.5rem">⚠️ PDF 매출월 ' + esc(P.month) + ' — 지금 정산월 ' + esc(YM) + ' 와 다름</div>' : '')
      + '<div style="font-size:15px;margin:.2rem 0 .7rem">' + (allOk ? '<b style="color:var(--g)">✔ 브론테 정산서가 우리 기록과 맞습니다</b>' : '<b style="color:#f87171">✘ 다른 곳이 있습니다 — 아래 확인</b>') + ' · 받을 돈 <b>' + won(recv) + '원</b></div>'
      + '<table class="ftbl" style="min-width:0"><thead><tr><th>확인</th><th>브론테 PDF</th><th>우리 기록</th><th></th></tr></thead><tbody>'
      + chk.map(function(c){ return '<tr><td style="white-space:nowrap"><b>' + c[0] + '</b></td><td>' + esc(c[1]) + '</td><td>' + esc(c[2]) + '</td><td>' + ok(c[3]) + '</td></tr>'; }).join('') + '</tbody></table>'
      + '<div class="sec-note" style="margin:.8rem 0 .3rem">이벗 「브론테」 주문 ' + O.rows.length + '줄</div>'
      + (O.rows.length ? '<table class="ftbl" style="min-width:0"><tbody>' + O.rows.map(function(x){ return '<tr><td>' + esc(x.d) + '</td><td>' + esc(x.name) + '</td><td class="n">수량 ' + esc(x.q) + '</td><td class="n">' + x.cans + '캔</td><td class="dim">' + esc(x.inv || '송장 없음') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="dim">이번 달 파일함 이벗 주문목록에 브론테 주문이 없습니다</div>')
      + (P.items.length ? '' : '<div class="chk warn" style="margin-top:.6rem">PDF 에서 상품 줄을 못 읽었습니다 — 형식이 바뀌었으면 대화창에 알려 주세요</div>'));
  }).catch(function(e){ body('<span style="color:#f87171">대조 실패: ' + esc((e && (e.code || e.message)) || e) + '</span>'); console.error(e); });
}
