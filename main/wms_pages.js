/* ============================================================
   WMS 페이지 목록 — 관리도구(wms_admin)와 사이트 통계(site_stats)가 함께 쓴다.
   새 페이지를 만들면 여기 한 곳에만 추가한다.
============================================================ */
/* ── 페이지 레지스트리 ──────────────────────────────────────────
   key   : pageAccess/{key} 에 저장되는 키. wms_access.js 의 data-page 와 반드시 일치.
   floor : 페이지가 정상 동작하기 위한 최소 등급 (실효 요구 = max(설정값, floor))
   gate  : true  = wms_access.js 게이트가 실제로 설치돼 있음 (설정이 바로 적용됨)
           false = 게이트 미설치 (설정해도 적용 안 됨 — 스니펫 안내 표시)
   self  : 페이지가 자체 인증 로직을 갖고 있을 때의 설명
   locked: 값 고정 페이지 (버튼 대신 안내 칩 표시)
   ───────────────────────────────────────────────────────────── */
var WMS_PAGES=[
  {group:'핵심 콘솔', items:[
    {key:'wms',          file:'wms.html',          label:'메이크창고 WMS (메인 콘솔)', floor:2, gate:true},
    {key:'wms_login',    file:'wms_login.html',    label:'로그인 · 그룹 관리', floor:0, gate:false,
      locked:'항상 공개', self:'로그인 관문 — 잠그면 아무도 로그인할 수 없어 고정입니다'},
    {key:'wms_admin',    file:'wms_admin.html',    label:'관리도구 · 페이지 접근권한 (이 페이지)', floor:3, gate:false,
      locked:'슈퍼관리자 고정', self:'superadmins 노드로 직접 검사 — 등급 변경 불가'},
    {key:'payroll',      file:'payroll.html',      label:'급여관리 (숨김 메뉴 · 2차 비밀번호)', floor:3, gate:true,
      locked:'슈퍼관리자 고정', self:'1차 슈퍼관리자 + 2차 비밀번호(데이터 암호화) — 등급을 낮춰도 DB 규칙이 슈퍼관리자만 허용'},
    {key:'site_stats',   file:'site_stats.html',   label:'사이트 통계 · 로그분석 (숨김 메뉴)', floor:3, gate:true,
      locked:'슈퍼관리자 고정', self:'슈퍼관리자 게이트(floor 3) + DB 규칙 stats 읽기는 슈퍼관리자만'},
    {key:'settlement',   file:'settlement.html',   label:'정산관리 (숨김 메뉴 · 3PL 업체별 정산)', floor:3, gate:true,
      locked:'슈퍼관리자 고정', self:'슈퍼관리자 게이트(floor 3) — 업체별 정산 기능은 진행하며 추가'},
  ]},
  {group:'업체(거래처) 관리', items:[
    {key:'wms_vendors',  file:'wms_vendors.html',  label:'업체등록 · 상품연결 (관리자)', floor:2, gate:true,
      self:'자체 인증: 슈퍼관리자만 통과'},
    {key:'vendor_list',  file:'vendor_list.html',  label:'업체 현황 · 낱개입력 (목록)', floor:2, gate:true,
      self:'자체 인증: 로그인 필수'},
    {key:'vendor_status',file:'vendor_status.html',label:'업체별 재고 현황 (담당자 보고서)', floor:1, gate:true,
      self:'자체 인증: vendorByEmail 매칭 — 거래처 담당자는 그룹 미가입이므로 초대회원 이상으로 올리지 마세요'},
  ]},
  {group:'출고 · 입고 도구 (그룹 동기화)', items:[
    {key:'cargo_log',    file:'cargo_log.html',    label:'입출고 화물관리 (기록지·파렛트 통계)', floor:2, gate:true},
    {key:'star_coupang', file:'star_coupang.html', label:'쿠팡 출고', floor:2, gate:true},
    {key:'star_outorder',file:'star_outorder.html',label:'출고 지시', floor:2, gate:true},
    {key:'star_instock', file:'star_instock.html', label:'입고 관리', floor:2, gate:true},
    {key:'star_picking', file:'star_picking.html', label:'피킹 (송장정렬)', floor:2, gate:true},
    {key:'star_extract', file:'star_extract.html', label:'데이터 추출', floor:2, gate:true},
    {key:'stock_check',       file:'stock_check.html',       label:'재고조사풀 (업체별 재고조사 모음)', floor:2, gate:true},
    {key:'stock_tales_minus', file:'stock_tales_minus.html', label:'└ 테일즈 마이너스재고 조정', floor:2, gate:true},
    {key:'picktalk',     file:'picktalk.html',     label:'피크톡', floor:2, gate:true},
    {key:'barcodeprint', file:'barcodeprint.html', label:'바코드 라벨 인쇄', floor:2, gate:true},
  ]},
  {group:'라벨 · 문서 도구', items:[
    {key:'label_fit',    file:'label_fit.html',    label:'PDF 라벨 규격맞추기 (100×140)', floor:0, gate:true},
    {key:'pdf_pdf',      file:'pdf_pdf.html',      label:'PDF 도구', floor:0, gate:true},
    {key:'pdf_smart_merge',file:'pdf_smart_merge.html',label:'PDF 스마트 병합', floor:0, gate:true},
    {key:'excel_merge',  file:'excel_merge.html',  label:'엑셀 병합', floor:0, gate:true},
  ]},
  {group:'로켓 · 외부몰 도구 (rocket/)', items:[
    {key:'rocket_index',   file:'rocket/index.html',       label:'크로스닥 팔레트 관리', floor:0, gate:true},
    {key:'rocket_tools',   file:'rocket/index2.html',      label:'Rocket WMS · 도구 모음', floor:0, gate:true},
    {key:'rocket_packing', file:'rocket/packing.html',     label:'쿠팡 팔레트 적재리스트 생성', floor:0, gate:true},
    {key:'rocket_kurly',   file:'rocket/kurly.html',       label:'컬리 거래명세서 → WMS 엑셀', floor:0, gate:true},
    {key:'rocket_picking', file:'rocket/pickinglist.html', label:'피킹리스트 생성기', floor:0, gate:true},
    {key:'rocket_csvup',   file:'rocket/csvup.html',       label:'PO 주소 매칭 (CSV)', floor:0, gate:true},
    {key:'rocket_pomatch', file:'rocket/PO_주소매칭_웹앱.html', label:'PO 주소 매칭 웹앱', floor:0, gate:true},
  ]},
  {group:'교육 · 튜토리얼', items:[
    {key:'wms-tutorial', file:'wms-tutorial.html', label:'WMS 튜토리얼', floor:0, gate:true},
    {key:'tutorial_ebut',file:'tutorial_ebut.html',label:'튜토리얼(이벗)', floor:0, gate:true},
    {key:'tutorial_ez',  file:'tutorial_ez.html',  label:'튜토리얼(이지)', floor:0, gate:true},
    {key:'picking_ebut', file:'picking_ebut.html', label:'피킹(이벗)', floor:0, gate:true},
    {key:'picking_ez',   file:'picking_ez.html',   label:'피킹(이지)', floor:0, gate:true},
  ]},
  {group:'기타 · 부가 서비스', items:[
    {key:'index',        file:'index.html',        label:'홈 / 랜딩', floor:0, gate:true},
    {key:'index-preview',file:'index-preview.html',label:'홈 미리보기 (App Grid)', floor:0, gate:true},
    {key:'stock',        file:'stock/index.html',  label:'Stock-Sync Advisor (재고)', floor:0, gate:true},
    {key:'snapmemo',     file:'snapmemo/index.html',label:'SnapMemo', floor:0, gate:true},
    {key:'blog',         file:'blog/index.html',   label:'블로그 AI 생성기', floor:0, gate:true},
    {key:'saju',         file:'saju.html',         label:'사주 (만신 AI)', floor:0, gate:true},
    {key:'saju_app',     file:'saju/index.html',   label:'사주 (만신 AI · 서브폴더)', floor:0, gate:true},
  ]},
];
