/* ============================================================
   정산관리 — 🔁 반품비 역추적 (대표님 2026-10-05)
   박스앤캔 택배비 「반품」 시트의 반품 등기번호마다
     ① 우체국 배송조회 맨 아래 「반품원등기번호」 = 원송장  (서버 함수 epostReturnOrigin — functions-settle/epost.js)
     ② 원송장 → 우리 자료에서 주인 찾기: 이벗 전체주문목록(송장번호 → 고객사·판매처·등록일·수령자)
                                        + 박스앤캔 「발송」 시트(등기번호 → 발송인명 메이크창고(업체))
        이번 달 + 지난 2달 파일함을 봄 — 달을 넘는 반품(지난달 보낸 것의 반품)도 자료가 쌓이면 잡힘, 못 찾은 건 다음에 다시
     ③ 반품 시트 고객명(메이크창고(업체))과 원송장 주인이 다르면 ⚠️ — 다른 업체 반품이 섞였거나 고객명이 틀린 것
   결과는 settlement/retTrace/{반품등기번호} = { orig, origDate, sender, recvDate, cust, seller, odate, src, oym, at } 에 쌓아 다시 조회 안 함
   업체 초안(makeDraft)의 반품 시트(등기번호·박스크기·납부방법 열)는 맨 오른쪽 「원송장」「원송장 고객사」 를 이 기록으로 채움 (retTraceFill)
   쓰는 전역: db, YM, BOX, ALLBOX, esc, toast, ymLabel, decryptBox, XLSX, firebase
============================================================ */
var RETTRACE = {};
function rtNo(v){ return String(v == null ? '' : v).replace(/\D/g, ''); }
function rtVendorOf(name){ var m = String(name || '').match(/\(([^)]+)\)\s*$/); return m ? m[1].trim() : String(name || '').trim(); }   /* 메이크창고(스타인터내셔널) → 스타인터내셔널 */
function rtListen(){ db.ref('settlement/retTrace').on('value', function(s){ RETTRACE = s.val() || {}; }); }
function rtPrevYms(ym, n){ var out = [ym], y = +ym.slice(0, 4), m = +ym.slice(5, 7); for (var i = 0; i < n; i++){ m--; if (!m){ m = 12; y--; } out.push(y + '-' + String(m).padStart(2, '0')); } return out; }
function rtSheet(wb, name, need){
  var ws = wb.Sheets[name] || null, names = ws ? [name] : wb.SheetNames;
  for (var k = 0; k < names.length; k++){ var a = XLSX.utils.sheet_to_json(wb.Sheets[names[k]], { header: 1, defval: '', raw: false });
    for (var i = 0; i < Math.min(a.length, 10); i++){ var h = a[i].map(function(x){ return String(x).replace(/\s+/g, ''); }); if (need.every(function(n){ return h.indexOf(n) >= 0; })) return { H: h, rows: a.slice(i + 1) }; } }
  return null;
}
/* 원송장 → 주인: 이벗 주문목록 + 박스앤캔 발송 (이번 달 + 지난 2달) */
function rtOwners(origs, msg){
  var want = {}; origs.forEach(function(o){ want[o] = 1; });
  var found = {}, files = [];
  rtPrevYms(YM, 2).forEach(function(ym){ var B = (typeof ALLBOX !== 'undefined' && ALLBOX[ym]) || (ym === YM ? BOX : {}) || {};
    Object.keys(B).forEach(function(id){ var m = B[id]; if (m && (m.type === 'ebut_orders' || m.type === 'bnc_courier') && !m.ref) files.push({ ym: ym, m: m }); }); });
  return files.reduce(function(p, f, i){ return p.then(function(){
    if (!Object.keys(want).some(function(o){ return !found[o]; })) return;
    msg && msg('원송장 주인 찾는 중 ' + (i + 1) + '/' + files.length + ' — ' + f.ym + ' ' + f.m.name);
    return decryptBox(f.m).then(function(b){ var wb = XLSX.read(b, { type: 'array', dense: true });
      if (f.m.type === 'ebut_orders'){ var T = rtSheet(wb, null, ['송장번호', '고객사']); if (!T) return;
        var c = function(n){ return T.H.indexOf(n); }, iN = c('송장번호'), iC = c('고객사'), iS = c('판매처'), iD = c('등록일'), iR = c('수령자'), iP = c('상품명');
        T.rows.forEach(function(r){ var k = rtNo(r[iN]); if (!k || !want[k] || found[k]) return;
          found[k] = { cust: String(r[iC] || '').trim(), seller: iS >= 0 ? String(r[iS] || '').trim() : '', odate: iD >= 0 ? String(r[iD] || '').slice(0, 10) : '', rcv: iR >= 0 ? String(r[iR] || '').trim() : '', item: iP >= 0 ? String(r[iP] || '').slice(0, 40) : '', src: '이벗 ' + f.ym, oym: f.ym }; });
      } else { var S = rtSheet(wb, '발송', ['등기번호', '발송인명']); if (!S) return;
        var e = function(n){ return S.H.indexOf(n); }, jN = e('등기번호'), jV = e('발송인명'), jD = e('접수일자'), jR = e('수취인명'), jI = e('우편물내역');
        S.rows.forEach(function(r){ var k = rtNo(r[jN]); if (!k || !want[k] || found[k]) return;
          var d = r[jD]; if (/^\d{5}$/.test(String(d))) d = new Date(Math.round((+d - 25569) * 864e5)).toISOString().slice(0, 10);
          found[k] = { cust: rtVendorOf(r[jV]), seller: '', odate: String(d || '').slice(0, 10), rcv: jR >= 0 ? String(r[jR] || '').trim() : '', item: jI >= 0 ? String(r[jI] || '').slice(0, 40) : '', src: '박스앤캔 발송 ' + f.ym, oym: f.ym }; });
      }
    }).catch(function(e){ console.error(e); });
  }); }, Promise.resolve()).then(function(){ return { found: found, nFiles: files.length }; });
}

function retTrace(id){
  var m = BOX[id]; if (!m) return;
  var ov = document.getElementById('rtOv'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'rtOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
  ov.innerHTML = '<div class="card" style="max-width:1180px;width:100%;margin:0"><div class="card-h"><span class="card-t">🔁 반품비 역추적 — ' + esc(ymLabel(YM)) + ' · ' + esc(m.name) + '</span>'
    + '<button class="btn" style="margin-left:auto" onclick="document.getElementById(\'rtOv\').remove()">닫기</button></div><div id="rtBody" class="sec-note">파일 여는 중…</div></div>';
  ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); }); document.body.appendChild(ov);
  var body = function(h){ var b = document.getElementById('rtBody'); if (b) b.innerHTML = h; };
  var rows = [];
  decryptBox(m).then(function(b){
    var T = rtSheet(XLSX.read(b, { type: 'array', dense: true }), '반품', ['등기번호', '고객명']);
    if (!T) throw new Error('「반품」 시트(등기번호·고객명)를 못 찾음');
    var c = function(n){ return T.H.indexOf(n); };
    T.rows.forEach(function(r){ var no = rtNo(r[c('등기번호')]); if (no.length < 10) return;
      rows.push({ d: String(r[c('배달일자')] || '').slice(0, 10), no: no, cust: String(r[c('고객명')] || '').trim(), size: String(r[c('박스크기')] || ''), pay: String(r[c('납부방법')] || ''), sender: String(r[c('발송인')] || '') }); });
    /* ① 우체국 조회 — 기록에 원송장이 없는 것만 (조회 실패·확인불가는 하루 지나면 다시) */
    var need = rows.filter(function(x){ var t = RETTRACE[x.no]; return !t || (!t.orig && Date.now() - (t.at || 0) > 864e5); }).map(function(x){ return x.no; });
    var fn = firebase.app().functions('asia-southeast1').httpsCallable('epostReturnOrigin'), done = 0, ups = {};
    var chunks = []; for (var i = 0; i < need.length; i += 40) chunks.push(need.slice(i, i + 40));
    return chunks.reduce(function(p, ch){ return p.then(function(){
      body('우체국 조회 중 ' + done + ' / ' + need.length + ' (반품 ' + rows.length + '건 중 새로 조회할 것)');
      return fn({ nos: ch }).then(function(res){ (res.data.rows || []).forEach(function(r){ var o = Object.assign({}, RETTRACE[r.no] || {}, { orig: r.orig || null, origDate: r.origDate || null, sender: r.sender || null, recvDate: r.recvDate || null, err: r.err || null, at: Date.now() });
        RETTRACE[r.no] = o; ups[r.no] = o; }); done += ch.length; });
    }); }, Promise.resolve()).then(function(){ if (Object.keys(ups).length) return db.ref('settlement/retTrace').update(ups); });
  }).then(function(){
    /* ② 원송장 주인 — 아직 못 찾은 것만 */
    /* 반품원등기번호가 없으면 그 등기번호 자체가 우리 발송 송장(반송 — 8월 제주맥주 6077… 4건)일 수 있어 그 번호로도 찾음 */
    var origs = rows.map(function(x){ var t = RETTRACE[x.no]; return t && !t.cust ? (t.orig || x.no) : null; }).filter(Boolean);
    return rtOwners(origs, body).then(function(R){
      var ups = {};
      rows.forEach(function(x){ var t = RETTRACE[x.no]; if (!t) return;
        if (!t.orig && R.found[x.no]){ t.orig = x.no; t.self = true; }
        if (!t.orig) return; var f = R.found[t.orig];
        if (f){ Object.assign(t, f); ups[x.no] = t; } else if (!t.cust){ t.tried = (t.tried || []).concat([YM]).filter(function(v, i, a){ return a.indexOf(v) === i; }); ups[x.no] = t; } });
      if (Object.keys(ups).length) db.ref('settlement/retTrace').update(ups);
      body(rtHtml(rows, m, R.nFiles));
    });
  }).catch(function(e){ body('<span style="color:#f87171">역추적 실패: ' + esc((e && (e.code || e.message)) || e) + '</span>'); console.error(e); });
}
function rtJudge(x){
  var t = RETTRACE[x.no] || {}, mine = rtVendorOf(x.cust);
  if (!t.orig) return { k: 'none', t: t.err ? '조회 실패' : '확인불가' };
  if (!t.cust) return { k: 'nf', t: '원송장 주인 못 찾음' };
  var hit = window.vendorMatcher(mine)(t.cust) || window.vendorMatcher(t.cust)(mine) || (t.seller && window.vendorMatcher(mine)(t.seller));
  return hit ? { k: 'ok', t: t.self ? '일치 (반송 — 원송장 그대로)' : '일치' } : { k: 'diff', t: '다른 업체' };
}
function rtHtml(rows, m, nFiles){
  var J = rows.map(function(x){ return rtJudge(x); }), cnt = { ok: 0, diff: 0, nf: 0, none: 0 }; J.forEach(function(j){ cnt[j.k]++; });
  var col = { ok: 'var(--g)', diff: '#f87171', nf: '#fbbf24', none: '#9ca3af' };
  var by = {}; rows.forEach(function(x, i){ var k = rtVendorOf(x.cust); (by[k] = by[k] || { n: 0, diff: 0 }).n++; if (J[i].k === 'diff') by[k].diff++; });
  var h = '<div style="font-size:14px;line-height:1.8;margin:.2rem 0 .7rem">반품 ' + rows.length + '건 · <b style="color:var(--g)">✔ 원송장 주인 일치 ' + cnt.ok + '</b> · <b style="color:#f87171">⚠️ 다른 업체 ' + cnt.diff + '</b> · <b style="color:#fbbf24">주인 못 찾음 ' + cnt.nf + '</b> · 원송장 확인불가 ' + cnt.none
    + '<br><span class="sm dim">원송장 = 우체국 「반품원등기번호」 · 주인 = 이벗 전체주문목록·박스앤캔 발송 (' + esc(rtPrevYms(YM, 2).join(', ')) + ' 파일함 ' + nFiles + '개) — 못 찾은 건 지난달 자료가 쌓이면 다시 누르면 잡힘</span></div>'
    + '<div class="sm" style="margin-bottom:.5rem">' + Object.keys(by).sort(function(a, b){ return by[b].n - by[a].n; }).map(function(k){ return esc(k) + ' ' + by[k].n + (by[k].diff ? ' <b style="color:#f87171">(다른 업체 ' + by[k].diff + ')</b>' : ''); }).join(' · ') + '</div>'
    + '<button class="btn p" onclick="rtDownload()">📥 엑셀로 받기 (반품 + 원송장 + 원송장 고객사)</button>'
    + '<div style="overflow-x:auto;margin-top:.6rem"><table class="ftbl"><thead><tr><th>배달일자</th><th>반품 등기번호</th><th>고객명(박스앤캔)</th><th>크기</th><th>발송인</th><th>원송장 (접수일)</th><th>원송장 고객사 · 판매처</th><th>주문일 · 출처</th><th>판정</th></tr></thead><tbody>'
    + rows.map(function(x, i){ var t = RETTRACE[x.no] || {}, j = J[i];
      return '<tr' + (j.k === 'diff' || j.k === 'nf' ? ' class="flag"' : '') + '><td style="white-space:nowrap">' + esc(x.d) + '</td><td style="font-family:var(--mo)">' + esc(x.no) + '</td><td>' + esc(x.cust) + '</td><td>' + esc(x.size) + '</td><td>' + esc(x.sender) + '</td>'
        + '<td style="font-family:var(--mo)">' + (t.orig ? esc(t.orig) + (t.origDate ? '<div class="sm dim">' + esc(t.origDate) + '</div>' : '') : '<span class="dim">확인불가</span>') + '</td>'
        + '<td>' + esc(t.cust || '') + (t.seller ? '<div class="sm dim">' + esc(t.seller) + '</div>' : '') + '</td><td class="sm">' + esc(t.odate || '') + (t.src ? '<div class="dim">' + esc(t.src) + '</div>' : '') + '</td>'
        + '<td><b style="color:' + col[j.k] + '">' + esc(j.t) + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  window._rtRows = rows;
  return h;
}
function rtDownload(){
  var rows = window._rtRows || [];
  var a = [['배달일자', '등기번호', '고객명', '박스크기', '납부방법', '발송인', '원송장', '원송장 접수일', '원송장 고객사', '판매처', '주문일', '찾은 곳', '판정']];
  rows.forEach(function(x){ var t = RETTRACE[x.no] || {}; a.push([x.d, x.no, x.cust, x.size, x.pay, x.sender, t.orig || '확인불가', t.origDate || '', t.cust || '', t.seller || '', t.odate || '', t.src || '', rtJudge(x).t]); });
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), '반품_역추적');
  XLSX.writeFile(wb, YM.replace('-', '') + '_반품비_역추적.xlsx');
}

/* 업체 초안: 반품 시트(등기번호·박스크기·납부방법) 맨 오른쪽 「원송장」「원송장 고객사」 채우기 — makeDraft 마지막에 (settle_build.js) */
window.retTraceFill = function(wb, log, vendorName){
  if (!RETTRACE || !Object.keys(RETTRACE).length) return;
  var nv = function(v){ if (v && v.richText) v = v.richText.map(function(t){ return t.text; }).join(''); if (v && typeof v === 'object' && 'result' in v) v = v.result; return String(v == null ? '' : v).replace(/\s+/g, ''); };
  wb.eachSheet(function(ws){
    var hm = {}, last = 0; ws.getRow(1).eachCell(function(c, n){ var h = nv(c.value); if (h) hm[h] = n; if (n > last) last = n; });
    if (!hm['등기번호'] || !hm['박스크기'] || !hm['납부방법']) return;
    var cO = hm['원송장'] || hm['원송장번호'], cC = hm['원송장고객사'];
    var st = ws.getRow(1).getCell(hm['등기번호']).style;
    if (!cO){ cO = ++last; ws.getRow(1).getCell(cO).value = '원송장'; ws.getRow(1).getCell(cO).style = JSON.parse(JSON.stringify(st || {})); }
    if (!cC){ cC = cO + 1; if (cC <= last && nv(ws.getRow(1).getCell(cC).value)) cC = ++last; ws.getRow(1).getCell(cC).value = '원송장 고객사'; ws.getRow(1).getCell(cC).style = JSON.parse(JSON.stringify(st || {})); }
    ws.getColumn(cO).width = Math.max(ws.getColumn(cO).width || 0, 16); ws.getColumn(cC).width = Math.max(ws.getColumn(cC).width || 0, 22);
    var n = 0, nf = 0, diff = [];
    ws.eachRow(function(row, r){ if (r === 1) return; var no = rtNo(nv(row.getCell(hm['등기번호']).value)); if (no.length < 10) return;
      var t = RETTRACE[no]; if (!t) return;
      if (!nv(row.getCell(cO).value)) row.getCell(cO).value = t.orig || '확인불가';
      row.getCell(cC).value = t.cust ? t.cust + (t.seller && t.seller !== t.cust ? ' · ' + t.seller : '') : (t.orig ? '주인 못 찾음' : '');
      n++; if (t.orig && !t.cust) nf++;
      if (t.cust && vendorName && !(window.vendorMatcher(vendorName)(t.cust) || window.vendorMatcher(t.cust)(vendorName) || (t.seller && window.vendorMatcher(vendorName)(t.seller)))){ diff.push(no + '→' + t.cust); row.getCell(cC).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } }; } });
    if (n) log.push(['자동 적용', '시트 「' + ws.name + '」 원송장·원송장 고객사 ' + n + '건 ← 🔁 반품비 역추적 기록' + (nf ? ' (주인 못 찾음 ' + nf + ')' : '')]);
    if (diff.length) log.push(['특이사항', '시트 「' + ws.name + '」 반품 ' + diff.length + '건은 원송장 주인이 다른 업체 — ' + diff.slice(0, 5).join(', ') + (diff.length > 5 ? ' …' : '') + ' (노란 칸, 이 업체 청구가 맞는지 확인)']);
  });
};
