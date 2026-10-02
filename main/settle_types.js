/* ============================================================
   정산 파일함 — 파일 종류 판별 규칙 (settlement.html)

   파일 이름은 매달 바뀌므로(end200edit_…, stm403main_…) 이름이 아니라
   시트 이름·제목줄(헤더) 같은 '내용'으로 종류를 알아본다.

   cat    : 'common' = 공통 파일 체크리스트에 나오는 파일 (multi 가 아니면 같은 종류를 다시 올리면 교체)
            'vendor' = 업체별 정산 때 쓰는 파일·기타 (여러 개 가능)
   multi  : 공통이지만 여러 개를 계속 추가하는 파일 (이벗 주문목록 추가분, 화물 청구서 여러 장)
   optional: 늦게 도착해서 없어도 정산을 진행할 수 있는 파일 (박스앤캔 택배비)
   test(f): f = { ext, name, sheets:[{ name, headers:Set, hdr:제목줄위치, rows }], allHeaders:Set }
   판별은 위에서부터 차례로 — 처음 맞는 종류로 정한다(거래내역서를 맨 앞에: 안에 배송비·용차비 시트가 있어서).
   summary(f, wb): 목록에 보일 한 줄 요약 (개인정보 없이 건수·업체명 정도만)

   새 종류는 여기 SETTLE_TYPES 에 추가하거나, 화면에서 '종류 지정'으로 가르치면
   (settlement/sigs) 다음 달부터 같은 모양의 파일을 자동으로 알아본다.
============================================================ */
(function(){
  'use strict';

  function hasAll(set, arr){ for (var i = 0; i < arr.length; i++) if (!set.has(arr[i])) return false; return true; }
  function sheetWith(f, arr){ for (var i = 0; i < f.sheets.length; i++) if (hasAll(f.sheets[i].headers, arr)) return f.sheets[i]; return null; }
  function sheetNamed(f, nm){ for (var i = 0; i < f.sheets.length; i++) if (f.sheets[i].name === nm) return f.sheets[i]; return null; }
  function nf(n){ return (n || 0).toLocaleString('ko-KR'); }

  /* 한 열의 값별 개수 상위 n개 — "A 120 · B 30 …" (제목줄 위치 s.hdr 부터 읽는다) */
  function topCounts(wb, s, header, n){
    try {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { defval: '', range: s.hdr || 0 });
      var m = {};
      rows.forEach(function(r){ var k = String(r[header] == null ? '' : r[header]).trim(); if (k) m[k] = (m[k] || 0) + 1; });
      var ks = Object.keys(m).sort(function(a, b){ return m[b] - m[a]; });
      return ks.slice(0, n || 4).map(function(k){ return k + ' ' + nf(m[k]); }).join(' · ') + (ks.length > (n || 4) ? ' 외 ' + (ks.length - (n || 4)) + '곳' : '');
    } catch (e) { return ''; }
  }

  var T = [
    /* ── 완료된 거래내역서 (먼저 판별) ── */
    { key:'statement', cat:'vendor', label:'거래내역서 (지난 정산서·표본)', icon:'📑',
      hint:'완료된 업체 거래명세표 — 업체 등록 때 표본으로 사용',
      test:function(f){ return /^\d{1,2}월_거래내역서_/.test(f.name) || (f.sheets.length >= 2 && /^(거래명세표|거래명세서|메이크창고_거래명세표|토탈합계)/.test(f.sheets[0].name)); },
      summary:function(f){ return '시트 ' + f.sheets.length + '개 (' + f.sheets.slice(0, 3).map(function(s){ return s.name; }).join(' · ') + (f.sheets.length > 3 ? ' …' : '') + ')'; } },

    /* ── 공통 ── */
    { key:'ebut_orders', cat:'common', multi:true, label:'이벗 전체주문목록', icon:'📋',
      hint:'이벗 → 주문목록 전체 다운로드 · 추가분은 계속 더 올리면 됨 (송장·주소 매칭, 제주 추가운임·연동몰 판매처 판별)',
      test:function(f){ return !!sheetWith(f, ['고객사','판매처','송장번호']); },   /* 크기 무관 — 추가분·위탁·초콜릿 목록도 모두 여기로 모아 송장번호로 합쳐 쓴다 */
      summary:function(f, wb){ var s = sheetWith(f, ['고객사','판매처','송장번호']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '고객사', 4); } },
    { key:'bnc_courier', cat:'common', optional:true, label:'박스앤캔 택배비 (우체국)', icon:'📮',
      hint:'택배사 청구 후 받는 파일 — 늦게 와도 됨. 반품비·항공비가 필요 없는 업체는 이 파일 없이 정산 가능',
      test:function(f){ var a = sheetNamed(f, '발송'), b = sheetNamed(f, '반품'); return !!(a && b && a.headers.has('등기번호')); },
      summary:function(f, wb){ var a = sheetNamed(f, '발송'), b = sheetNamed(f, '반품');
        return '발송 ' + nf(a.rows) + ' · 반품 ' + nf(b.rows) + ' · ' + topCounts(wb, a, '발송인명', 3).replace(/메이크창고\(/g, '').replace(/\)/g, ''); } },
    { key:'freight', cat:'common', multi:true, label:'화물 청구서 · 용차비 청구서', icon:'🚚',
      hint:'운송업체 월 청구서 — 올리면 지난 단가와 비교해 달라진 금액을 확인 항목으로 띄움',
      test:function(f){ return !!sheetWith(f, ['출발지','도착지','차종']); },
      summary:function(f, wb){ var p = freightSheet(f); if (!p) return ''; return (p.src === 'bill' ? p.s.name + '(업체 청구용)' : '⚠ Sheet1 없음 — ' + p.s.name + '(배차업체 지급액)') + ' 기준 · ' + topCounts(wb, p.s, '업체명', 4); } },
    { key:'cargo_io', cat:'vendor', label:'화물 입출고 엑셀 (참고용)', icon:'🏗️',
      hint:'예전 엑셀 기록 — 정산은 입출고 화물관리 페이지 데이터를 씁니다',
      test:function(f){ return !!sheetWith(f, ['업체명','파렛트수']) && !!(sheetWith(f, ['입출고-기타','업체명']) || sheetNamed(f, '입출고내역')); },
      summary:function(f, wb){ var s = sheetWith(f, ['입출고-기타','업체명','파렛트수']) || sheetWith(f, ['업체명','파렛트수']); return nf(s.rows) + '행 · ' + topCounts(wb, s, '업체명', 4); } },
    { key:'labor', cat:'vendor', output:true, label:'도급비 청구서 (알바·인력)', icon:'👷',
      hint:'인력업체 월 도급비 — 청구·근태 시트',
      test:function(f){ return !!(sheetNamed(f, '청구') && sheetNamed(f, '근태')); },
      summary:function(f){ return '청구·근태 시트'; } },
    { key:'settle_mgmt', cat:'vendor', output:true, label:'삼자물류 정산관리표', icon:'🗂️',
      hint:'00_삼자물류정산관리 — 업체별 정산금액·계산서 발행 관리',
      test:function(f){ return !!sheetWith(f, ['업체명','정산금액']); },
      summary:function(f){ return '시트 ' + f.sheets.length + '개 (' + f.sheets[0].name + ' …)'; } },
    { key:'tax_form', cat:'vendor', output:true, label:'세금계산서 등록양식', icon:'🧾',
      hint:'홈택스 일괄발행 엑셀 업로드 양식',
      test:function(f){ return !!sheetNamed(f, '엑셀업로드양식'); },
      summary:function(f){ var s = sheetNamed(f, '엑셀업로드양식'); return nf(s.rows) + '행'; } },

    /* ── 업체별 ── */
    { key:'ebut_shiplist', cat:'vendor', label:'이벗 택배비 리스트', icon:'📦',
      hint:'이벗 출고 송장 리스트(택배크기 포함) — 업체 배송비 시트 원본',
      test:function(f){ return !!sheetWith(f, ['등록일','출고일','판매처명','택배크기','송장번호']); },
      summary:function(f, wb){ var s = sheetWith(f, ['판매처명','택배크기','송장번호']); return nf(s.rows) + '건 · ' + topCounts(wb, s, '출력양식', 3); } },
    { key:'ebut_stock', cat:'vendor', label:'이벗 재고현황', icon:'📊',
      hint:'이벗 재고 다운로드 — 월말 전산재고 시트',
      test:function(f){ return !!sheetWith(f, ['가용재고수량','불량재고수량','옵션코드']); },
      summary:function(f){ var s = sheetWith(f, ['가용재고수량','불량재고수량']); return nf(s.rows) + '품목'; } },
    { key:'coupang_po', cat:'vendor', label:'쿠팡 발주서·입고내역', icon:'🛒',
      hint:'쿠팡 발주번호·SKU·물류센터 목록',
      test:function(f){ return !!sheetWith(f, ['발주번호','물류센터']) && !!(sheetWith(f, ['SKU ID']) || sheetWith(f, ['SKU 이름'])); },
      summary:function(f){ var s = sheetWith(f, ['발주번호','물류센터']); return nf(s.rows) + '행'; } },
    { key:'p9_row', cat:'vendor', label:'포인트나인크루 출고 ROW', icon:'🥛',
      hint:'곡물도감·셀시어스·오리진케어 출고 원본(WorkSheet)',
      test:function(f){ return !!sheetWith(f, ['발주일','모데명','송장번호','관리번호']); },
      summary:function(f){ var s = sheetWith(f, ['발주일','모데명','송장번호']); return nf(s.rows) + '행 · 시트 ' + f.sheets.length + '개'; } },
    { key:'jeju_stock', cat:'vendor', label:'제주맥주 재고파악', icon:'🍺',
      hint:'제주맥주 월말 재고현황·출고·입고 목록',
      test:function(f){ return !!sheetWith(f, ['현재실재고','불량재고']); },
      summary:function(f){ return '시트 ' + f.sheets.map(function(s){ return s.name; }).join(' · '); } },
    { key:'pdf', cat:'vendor', label:'PDF 문서', icon:'📄',
      hint:'거래내역서·원장·명세서 PDF',
      test:function(f){ return f.ext === 'pdf'; },
      summary:function(f){ return 'PDF'; } },
    { key:'image', cat:'vendor', label:'이미지', icon:'🖼️',
      hint:'계좌 사본 등 이미지',
      test:function(f){ return /^(png|jpe?g|gif|webp)$/.test(f.ext); },
      summary:function(f){ return '이미지'; } }
  ];

  /* 화물 청구서에서 읽을 시트 고르기 — 항상 화주(업체) 청구용 'Sheet1' 이 기준 (사용자 지시 2026-10-02).
       결제금액명세서·월결제금액명세서 = 배차업체에 주는 실제 지급액(원가). Sheet1 = 각 업체에 청구할 금액(수수료 포함 가능).
     1) 이름이 Sheet1  2) 결제금액명세서가 아닌 시트 중 출발지·도착지·차종 제목줄이 있는 것  3) 없을 때만 결제금액명세서(경고) */
  function freightSheet(f){
    var isCost = function(s){ return /결제금액명세서/.test(s.name); };
    var s1 = sheetNamed(f, 'Sheet1');
    if (s1 && s1.headers.has('출발지')) return { s: s1, src: 'bill' };
    for (var i = 0; i < f.sheets.length; i++){ var x = f.sheets[i]; if (!isCost(x) && hasAll(x.headers, ['출발지','도착지','차종'])) return { s: x, src: 'bill' }; }
    var c = sheetNamed(f, '결제금액명세서'); if (c && c.headers.has('출발지')) return { s: c, src: 'cost' };
    var any = sheetWith(f, ['출발지','도착지','차종']); return any ? { s: any, src: 'cost' } : null;
  }
  /* 화물 청구서 행 읽기 → { sheet, src:'bill'|'cost', rows }
     NO 열이 있으면 NO 가 숫자인 줄이 한 건, 없으면(Sheet1) 출발지·도착지가 있는 줄이 한 건.
     그 외에 수량·비고만 있는 줄은 바로 위 건의 추가 내용(예: 2층 1파렛트). '계' 줄은 건너뜀. */
  function parseFreight(f, wb){
    var pick = freightSheet(f); if (!pick) return { sheet: '', src: '', rows: [], costOnly: [] };
    var rows = readFreightRows(wb, pick.s), costOnly = [];
    /* 원본(결제금액명세서 = 실제 지급액)과 짝 맞추기 — 날짜·구간·차종·수량이 같은 건끼리, 금액이 같은 것 먼저.
       짝이 맞으면 r.cost = 원본 금액. 원본에만 있는 건(청구 안 한 회차 등)은 costOnly 로. */
    var cs = pick.src === 'bill' ? sheetNamed(f, '결제금액명세서') : null;
    if (cs && cs.headers.has('출발지')){
      var cost = readFreightRows(wb, cs), pool = {}, used = {};
      var K = function(r){ return r.d + '|' + freightKey(r) + '|' + r.qty; };
      cost.forEach(function(c, i){ (pool[K(c)] = pool[K(c)] || []).push(i); });
      rows.forEach(function(b){
        var L = pool[K(b)] || [], j = null, x;
        for (x = 0; x < L.length; x++) if (!used[L[x]] && cost[L[x]].amt === b.amt){ j = L[x]; break; }
        if (j == null) for (x = 0; x < L.length; x++) if (!used[L[x]]){ j = L[x]; break; }
        if (j != null){ used[j] = 1; b.cost = cost[j].amt; if (cost[j].vendor) b.costVendor = cost[j].vendor; }
      });
      cost.forEach(function(c, i){ if (!used[i]) costOnly.push(c); });
    }
    return { sheet: pick.s.name, src: pick.src, rows: rows, costOnly: costOnly };
  }
  function readFreightRows(wb, s){
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { defval: '', range: s.hdr || 0, raw: true });
    var out = [], numOf = function(v){ var n = Number(String(v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; };
    var dateOf = function(v){
      if (typeof v === 'number' && v > 30000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
      var m = String(v).match(/(\d{1,2})[.\/-](\d{1,2})/); return m ? ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : String(v || '');
    };
    rows.forEach(function(r){
      var no = r['NO.'] != null && r['NO.'] !== '' ? r['NO.'] : r['NO'];
      var hasNo = ('NO.' in r) || ('NO' in r);
      var isRow = hasNo ? (no !== '' && no != null && isFinite(Number(no))) : !!(r['출발지'] || r['도착지']);
      if (String(no).trim() === '계') return;
      if (isRow){
        out.push({ d: dateOf(r['일자']), from: String(r['출발지'] || '').trim(), to: String(r['도착지'] || '').trim(), car: String(r['차종'] || '').trim(),
          qty: String(r['수량'] == null ? '' : r['수량']).trim(), item: String(r['운송품목'] || '').trim(),
          amt: numOf(r['금액']), etc: numOf(r['기타']), tot: r['합계금액'] === '' ? null : numOf(r['합계금액']),
          note: String(r['비고'] || '').trim(), vendor: String(r['업체명'] || '').trim() });
      } else if (out.length && (r['수량'] !== '' || r['비고'] !== '')){
        var p = out[out.length - 1];
        p.extra = (p.extra ? p.extra + ' / ' : '') + [r['수량'], r['운송품목'], r['비고']].filter(function(x){ return x !== '' && x != null; }).join(' ');
      }
    });
    return out;
  }
  /* 단가 비교 열쇠: 출발지→도착지·차종 (띄어쓰기·대소문자 무시) */
  function freightKey(r){ var n = function(x){ return String(x || '').replace(/\s+/g, '').toUpperCase(); }; return n(r.from) + '→' + n(r.to) + '·' + n(r.car); }

  window.SETTLE_FREIGHT = { parse: parseFreight, key: freightKey };
  window.SETTLE_TYPES = T;
  window.SETTLE_TYPE = function(key){ for (var i = 0; i < T.length; i++) if (T[i].key === key) return T[i]; return null; };
})();
