/* ============================================================
   정산관리 — 🏢 업체 정산 탭 (settlement.html 에서 사용)

   흐름: 파일함에 올린 지난달 완료 거래내역서(표본)를 고르면 그 업체의 이번 달 작성이 시작된다.
     1) 표본을 열어(복호화) settle_stmt.js 로 분석 — 거래명세표 항목·단가·금액, 수량이 어디서 왔는지
     2) 표본 안의 데이터 시트마다 이번 달 파일함에서 짝이 될 원본 후보를 보여 준다
     3) 항목·시트마다 '이번 달 룰'(말로 적어도 됨)을 적어 저장 → 업체별 자동 계산을 여기에 붙여 나간다

   저장: settlement/vendors/{업체키} = { name, sample:{ym,id,name}, rules:{ items:{행:{name,text}}, sheets:{시트키:{name,text}}, memo }, at }
   쓰는 전역: db, YM, BOX, esc, $, toast, getBytes, WMS2FA, SETTLE_STMT, typeOf, ymLabel, fsize (settlement.html)
============================================================ */
var ALLBOX = {}, VENDORS = {}, VW = null;   /* VW = 지금 열린 작업 { vkey, name, fileId, ym, A(분석), zero } */
var STMT_CACHE = {};

function vKey(name){ return String(name || '').trim().replace(/[.#$/\[\]]/g, '_') || '_'; }
function sKey(name){ return String(name || '').replace(/[.#$/\[\]]/g, '_'); }

/* 파일함 전체(모든 달)에서 표본(거래내역서) 모으기 → 업체별 */
function samplesByVendor(){
  var g = {};
  Object.keys(ALLBOX).forEach(function(ym){
    Object.keys(ALLBOX[ym] || {}).forEach(function(id){
      var m = ALLBOX[ym][id]; if (!m || m.type !== 'statement') return;
      var name = SETTLE_STMT.vendorFromFile(m.name);
      (g[name] = g[name] || []).push({ ym: ym, id: id, m: m });
    });
  });
  Object.keys(g).forEach(function(k){ g[k].sort(function(a, b){ return a.ym < b.ym ? 1 : -1; }); });
  return g;
}

function renderVendors(){
  var box = $('tabVendors'); if (!box) return;
  if (VW) return renderWork();
  var g = samplesByVendor(), names = Object.keys(g).sort(function(a, b){ return a.localeCompare(b, 'ko'); });
  var html = '<div class="bar"><span class="bar-t">업체 정산</span><span class="sec-note">작성할 정산월: <b>' + esc(ymLabel(YM)) + '</b> (파일함 탭에서 바꿈)</span></div>'
    + '<div class="sec-note" style="margin-bottom:.9rem">지난달 완료 거래내역서(표본)를 고르면 그 업체 정산 작성이 시작됩니다. 표본은 파일함에 올린 <b>MM월_거래내역서_업체명</b> 파일에서 자동으로 모읍니다.</div>';
  if (!names.length){
    html += '<div class="soon">아직 표본이 없습니다.<br>파일함에서 정산월을 <b>지난달</b>로 바꾸고 <b>00_정산서완료</b> 폴더의 거래내역서를 올려 주세요.</div>';
  } else {
    html += '<div class="card"><div class="card-h"><span class="card-t">업체 ' + names.length + '곳</span><span class="card-s">룰을 적어 둔 업체는 ✍️ 표시</span></div>'
      + names.map(function(n){
        var list = g[n], v = VENDORS[vKey(n)], cnt = v && v.rules ? (Object.keys(v.rules.items || {}).length + Object.keys(v.rules.sheets || {}).length + (v.rules.memo ? 1 : 0)) : 0;
        var pickSel = list.length > 1 ? '<select class="tsel" id="smp_' + vKey(n) + '">' + list.map(function(x){ return '<option value="' + x.ym + '|' + x.id + '">' + esc(ymLabel(x.ym)) + ' · ' + esc(x.m.name) + '</option>'; }).join('') + '</select>'
          : '<span class="sm dim">' + esc(ymLabel(list[0].ym)) + ' · ' + esc(list[0].m.name) + '</span>';
        return '<div class="row"><div class="ck">' + (cnt ? '✍️' : '🏢') + '</div><div class="lb">' + esc(n) + (cnt ? '<small>룰 ' + cnt + '개 적음</small>' : '<small>아직 룰 없음</small>') + '</div>'
          + '<div class="fi">' + pickSel + '</div>'
          + '<div class="ac"><button class="btn p" data-n="' + esc(n) + '" onclick="startVendor(this.dataset.n)">' + esc(ymLabel(YM)) + ' 작성 ▸</button></div></div>';
      }).join('') + '</div>';
  }
  box.innerHTML = html;
}

function startVendor(name){
  var g = samplesByVendor()[name]; if (!g || !g.length) return;
  var sel = $('smp_' + vKey(name)), pick = g[0];
  if (sel){ var p = sel.value.split('|'); pick = g.filter(function(x){ return x.ym === p[0] && x.id === p[1]; })[0] || g[0]; }
  VW = { vkey: vKey(name), name: name, fileId: pick.id, ym: pick.ym, meta: pick.m, A: null, zero: false, err: '' };
  renderWork();
  var ck = pick.ym + '/' + pick.id;
  var go = STMT_CACHE[ck] ? Promise.resolve(STMT_CACHE[ck]) : getBytes(pick.m.path)
    .then(function(ab){ return WMS2FA.decrypt(pick.m.path, pick.m.iv, ab); })
    .then(function(bytes){ var A = SETTLE_STMT.analyze(XLSX.read(bytes, { type: 'array', cellFormula: true })); STMT_CACHE[ck] = A; return A; });
  go.then(function(A){ if (VW && VW.fileId === pick.id){ VW.A = A; renderWork(); } })
    .catch(function(e){ if (VW){ VW.err = (e && (e.code || e.message)) || String(e); renderWork(); } });
  /* 업체 기록 — 처음 열면 만든다 */
  var v = VENDORS[VW.vkey];
  if (!v || !v.sample || v.sample.id !== pick.id)
    db.ref('settlement/vendors/' + VW.vkey).update({ name: name, sample: { ym: pick.ym, id: pick.id, name: pick.m.name }, at: firebase.database.ServerValue.TIMESTAMP });
}
function closeWork(){ VW = null; renderVendors(); }

/* 표본 시트 종류 → 이번 달 파일함에서 찾을 종류 */
var KIND2BOX = { ebut_shiplist:['ebut_shiplist'], ebut_orders:['ebut_orders'], bnc_return:['bnc_courier'], bnc_courier:['bnc_courier'],
  freight:['freight'], coupang_po:['coupang_po'], p9_row:['p9_row'], ebut_stock:['ebut_stock'], jeju_stock:['jeju_stock'] };
function candidates(kind){
  if (!kind) return '';
  if (kind.key === 'cargo_store') return '<span class="chk okk">화물관리 페이지 ' + esc(ymLabel(YM)) + ' 기록</span>';
  var want = KIND2BOX[kind.key] || [];
  var hits = Object.keys(BOX).filter(function(id){ return want.indexOf(BOX[id].type) >= 0; });
  if (!hits.length) return '<span class="chk warn">' + esc(ymLabel(YM)) + ' 파일함에 없음</span>';
  return hits.map(function(id){ return '<div class="sm">📎 ' + esc(BOX[id].name) + '</div>'; }).join('');
}

function ruleBox(kind, key, name, val){
  return '<textarea class="rule" data-k="' + kind + '" data-key="' + esc(key) + '" data-name="' + esc(name) + '" rows="2" placeholder="이번 달 룰 — 예: 택배비 리스트에서 택배크기=극소 건수, 누락오배송 제외" onblur="saveRule(this)">' + esc(val || '') + '</textarea>';
}
function saveRule(el){
  if (!VW) return;
  var path = 'settlement/vendors/' + VW.vkey + '/rules/' + (el.dataset.k === 'memo' ? 'memo' : el.dataset.k + '/' + el.dataset.key);
  var v = el.value.trim(), old = el.dataset.saved != null ? el.dataset.saved : (el.defaultValue || '').trim();
  if (v === old) return;
  var p = el.dataset.k === 'memo' ? db.ref(path).set(v || null) : db.ref(path).set(v ? { name: el.dataset.name, text: v, at: firebase.database.ServerValue.TIMESTAMP } : null);
  p.then(function(){ el.dataset.saved = v; el.classList.add('saved'); setTimeout(function(){ el.classList.remove('saved'); }, 900); })
   .catch(function(e){ toast('저장 실패: ' + ((e && e.code) || e)); });
}

function won(n){ return n == null ? '' : Math.round(n).toLocaleString('ko-KR'); }
function renderWork(){
  var box = $('tabVendors'); if (!box || !VW) return;
  var v = VENDORS[VW.vkey] || {}, R = v.rules || {}, A = VW.A;
  var head = '<div class="bar"><button class="btn" onclick="closeWork()">← 업체 목록</button>'
    + '<span class="bar-t">' + esc(VW.name) + ' · ' + esc(ymLabel(YM)) + ' 정산 작성</span>'
    + '<span class="sec-note">표본: ' + esc(ymLabel(VW.ym)) + ' ' + esc(VW.meta.name) + '</span></div>';
  if (VW.err){ box.innerHTML = head + '<div class="soon">표본을 열지 못했습니다: ' + esc(VW.err) + '</div>'; return; }
  if (!A){ box.innerHTML = head + '<div class="soon">표본을 여는 중… (암호 풀고 엑셀 읽기)</div>'; return; }
  var items = VW.zero ? A.items : A.items.filter(function(i){ return !i.zero; });
  var sum = A.items.reduce(function(a, i){ return a + (i.amt.v || 0); }, 0);
  var itemRows = items.map(function(it){
    var rr = (R.items || {})[it.r];
    return '<tr' + (it.zero ? ' class="dimrow"' : '') + '><td class="dim">' + it.r + '</td>'
      + '<td><b>' + esc(it.name) + '</b>' + (it.size ? '<div class="dim">' + esc(it.size) + '</div>' : '') + (it.date ? '<div class="dim">' + esc(it.date) + '</div>' : '') + '</td>'
      + '<td class="n">' + won(it.qty.v) + '</td><td class="n">' + won(it.price.v) + '</td><td class="n">' + won(it.amt.v) + '</td>'
      + '<td class="src"><span class="srck ' + it.qty.src.kind + '">' + esc(it.qty.src.text) + '</span>' + (it.note ? '<div class="dim">' + esc(it.note) + '</div>' : '') + '</td>'
      + '<td>' + ruleBox('items', String(it.r), it.name, rr && rr.text) + '</td></tr>';
  }).join('');
  var sheetRows = A.sheets.map(function(s){
    var rr = (R.sheets || {})[sKey(s.name)];
    return '<tr><td><b>' + esc(s.name) + '</b><div class="dim">' + s.rows.toLocaleString() + '행</div></td>'
      + '<td>' + (s.kind ? esc(s.kind.label) : '<span class="dim">?</span>') + '<div class="dim" style="font-size:11px">' + esc(s.headers.slice(0, 8).join(' · ')) + '</div></td>'
      + '<td class="dim">' + (s.usedBy.length ? s.usedBy.map(function(x){ return x + '행'; }).join(', ') : '-') + '</td>'
      + '<td>' + candidates(s.kind) + '</td>'
      + '<td>' + ruleBox('sheets', sKey(s.name), s.name, rr && rr.text) + '</td></tr>';
  }).join('');
  box.innerHTML = head
    + '<div class="card"><div class="card-h"><span class="card-t">표본 요약</span><span class="card-s">시트 「' + esc(A.sheet) + '」</span></div>'
    + '<div class="sm">항목 ' + A.items.filter(function(i){ return !i.zero; }).length + '개 (0원 줄 ' + A.items.filter(function(i){ return i.zero; }).length + '개) · 데이터 시트 ' + A.sheets.length + '개'
    + ' · 소계 ' + won(A.totals.sub) + '원 · 합계 ' + won(A.totals.total) + '원 · 항목 금액 합 ' + won(sum) + '원</div></div>'

    + '<div class="card"><div class="card-h"><span class="card-t">① 거래명세표 항목</span><span class="card-s">지난달 수량이 어디서 왔는지 · 오른쪽에 이번 달 룰을 적으면 칸을 벗어날 때 저장</span>'
    + '<label class="dim" style="margin-left:auto;font-size:12px"><input type="checkbox" ' + (VW.zero ? 'checked' : '') + ' onchange="VW.zero=this.checked;renderWork()"> 0원 줄도 보기</label></div>'
    + '<div style="overflow-x:auto"><table class="ftbl wk"><thead><tr><th>행</th><th>내역</th><th style="text-align:right">수량</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th><th>수량 출처 · 비고</th><th>이번 달 룰</th></tr></thead><tbody>' + itemRows + '</tbody></table></div></div>'

    + '<div class="card"><div class="card-h"><span class="card-t">② 데이터 시트</span><span class="card-s">표본 안의 근거 시트 · 이번 달 파일함에서 짝이 될 원본</span></div>'
    + (sheetRows ? '<div style="overflow-x:auto"><table class="ftbl wk"><thead><tr><th>시트</th><th>종류 · 제목줄</th><th>쓰는 항목</th><th>' + esc(ymLabel(YM)) + ' 원본</th><th>룰 (가져오는 방법·조건)</th></tr></thead><tbody>' + sheetRows + '</tbody></table></div>' : '<div class="empty-s">데이터 시트 없음</div>') + '</div>'

    + '<div class="card"><div class="card-h"><span class="card-t">③ 업체 특이사항</span><span class="card-s">매달 확인할 것, 예외, 연락 사항 등</span></div>'
    + '<textarea class="rule" data-k="memo" data-key="memo" data-name="memo" rows="3" placeholder="예: 매달 말일 재고표 함께 보냄 · 용차비는 Sheet1 금액 · 쿠팡 입고작업은 발주서 확정수량 기준" onblur="saveRule(this)">' + esc(R.memo || '') + '</textarea></div>';
}
