/* ============================================================
   SnapMemo v5 — app.js
   구조:
     1) state · DOM refs · 상수
     2) utilities (상태표시, 토스트, 포맷, HTML escape)
     3) store (localStorage 영속화)
     4) image loader (파일 → JPEG canvas)
     5) crop tool (드래그 선택 → 이미지 좌표 변환)
     6) analyzer (/api/analyze 호출 → todos 생성)
     7) tabs / renderer / 이벤트 위임
     8) stats / init
   ============================================================ */
(() => {
  'use strict';

  // ---------- 1) State ----------
  const state = {
    todos: [],
    currentTab: 'active',
    sortMode: 'date',        // 'date' | 'due' | 'group' | 'similar' | 'manual'
    archiveFilter: 'all',    // 'all' | <category string> — 보관 탭에서 카테고리로 필터링
    categories: [],          // 통합 카테고리 풀 (기본 6개 + 사용자 추가, '기타'는 항상 마지막)
    categoryColors: {},      // { [카테고리명]: 'c1'..'c6' | 'b1'..'b6' } — 카테고리별 스와치 매핑
    pickerTodoId: null,      // 카테고리 바텀시트가 열려 있는 대상 todo의 id (문자열) — null=닫힘
    pickerAdding: false,     // 바텀시트 안에서 '+ 새 카테고리' 입력 모드인지
    colorEditingFor: null,   // 시트에서 색상 패널이 펼쳐진 카테고리명 (null=모두 접힘)
    dragId: null,            // 드래그 중인 항목 id (문자열)

    // 분석할 이미지 원본
    sourceCanvas: null,
    sourceWidth: 0,
    sourceHeight: 0,

    // 대기 중인 크롭 배치: [{ dataUrl, b64 }]
    cropQueue: [],

    // 크롭 드래그 상태 (cropWrap 기준 픽셀 좌표)
    isDragging: false,
    startPx: null,   // { x, y }
    currentPx: null  // { x, y }
  };

  const STORAGE_KEY   = 'snapmemo.todos.v5';
  const SORT_KEY      = 'snapmemo.sort.v1';
  const ATAG_KEY      = 'snapmemo.archiveFilter.v1';
  const CATS_KEY      = 'snapmemo.categories.v1';
  const CATCOLORS_KEY = 'snapmemo.categoryColors.v1';
  // 구버전 키 — 마이그레이션 후 삭제
  const LEGACY_ATAGS_KEY = 'snapmemo.archiveTags.v1';

  // AI가 분류하는 기본 카테고리 6종 — 이후 사용자가 보관 탭에서 자유롭게 추가/삭제
  // '기타'는 폴백이라 삭제 불가, 항상 리스트 끝
  const DEFAULT_CATEGORIES = ['업무', '일정', '아이디어', '연락', '쇼핑', '기타'];
  const CATEGORY_FALLBACK  = '기타';
  const MAX_CATEGORY_LEN   = 12;

  // ===== 2단 스와치 팔레트 (12색) =====
  // 파스텔(c1..c6): 일반 분류용. 같은 계통 진한 글씨로 가독성 확보
  // 볼드(b1..b6): "중요!" 등 강조용. 진한 바탕 + 흰 글씨로 시각 우선순위↑
  // c5(파스텔 회색)는 '기타' 폴백 전용 — 사용자 직접 변경은 가능하나 권장 X
  const PASTEL_KEYS = ['c1','c2','c3','c4','c5','c6'];
  const BOLD_KEYS   = ['b1','b2','b3','b4','b5','b6'];
  const SWATCH_KEYS = [...PASTEL_KEYS, ...BOLD_KEYS];
  // 기본 카테고리별 권장 색 — 디자인 일관성 위해 시드값 고정
  const DEFAULT_COLOR_FOR = {
    '업무':     'c1',  // 파랑 (차분/업무)
    '일정':     'c2',  // 주황 (시간감)
    '아이디어': 'c3',  // 보라 (창의)
    '연락':     'c4',  // 분홍 (대인)
    '쇼핑':     'c6',  // 초록 (소비/완료감)
    '기타':     'c5'   // 회색 (중립)
  };
  // 사용자 추가 카테고리에 자동 할당할 파스텔 순환 (c5 회색 제외)
  const AUTO_PASTEL_CYCLE = ['c1','c2','c3','c4','c6'];

  function catColorClass(cat) {
    const key = state.categoryColors && state.categoryColors[cat];
    if (key && SWATCH_KEYS.includes(key)) return 'cat-' + key;
    if (DEFAULT_COLOR_FOR[cat])           return 'cat-' + DEFAULT_COLOR_FOR[cat];
    return 'cat-c5';  // 안전 폴백
  }

  const $ = (id) => document.getElementById(id);
  const el = {
    fileInput:   $('fi'),
    cameraInput: $('fc'),
    cropSection: $('cropSection'),
    cropWrap:    $('cropWrap'),
    cropCanvas:  $('cropCanvas'),
    selRect:     $('selRect'),
    cropConfirm: $('cropConfirm'),
    cropFull:    $('cropFull'),
    cropAnalyze: $('cropAnalyze'),
    cropReset:   $('cropReset'),
    cropQueue:   $('cropQueue'),
    recropBtn:   $('recropBtn'),
    statusBox:   $('statusBox'),
    dateHelper:  $('dateHelper'),
    toast:       $('toast'),
    itemList:    $('itemList'),
    atagBar:     $('atagBar'),
    catSheet:           $('catSheet'),
    catSheetBackdrop:   $('catSheetBackdrop'),
    catSheetList:       $('catSheetList'),
    catSheetClose:      $('catSheetClose'),
    stats: {
      total:    $('sT'),
      done:     $('sD'),
      progress: $('sP'),
      archived: $('sA')
    }
  };

  // ---------- 2) Utilities ----------
  function setStatus(type, msg) {
    el.statusBox.className = 'status-box' + (type ? ' ' + type : '');
    el.statusBox.style.display = msg ? 'block' : 'none';
    el.statusBox.innerHTML = type === 'loading'
      ? `<span class="dots"><span></span><span></span><span></span></span>${escapeHtml(msg)}`
      : escapeHtml(msg);
  }

  let toastTimer = null;
  function showToast(msg, ms = 2600) {
    el.toast.textContent = msg;
    el.toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.style.display = 'none'; }, ms);
  }

  function formatDate(d = new Date()) {
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = d.getHours();
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  }

  // 'YYYY-MM-DD' → 화면 라벨 + 상태 클래스
  // 반환: { label, klass, days } 또는 null (iso가 없거나 파싱 실패 시)
  function dueInfo(iso) {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const due = new Date(+m[1], +m[2] - 1, +m[3]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((due - today) / 86400000);
    let tail, klass;
    if (days < 0)       { tail = `D+${-days} 지남`;  klass = 'overdue'; }
    else if (days === 0){ tail = '오늘';             klass = 'today';   }
    else if (days === 1){ tail = '내일';             klass = 'soon';    }
    else if (days <= 3) { tail = `D-${days}`;        klass = 'soon';    }
    else                { tail = `D-${days}`;        klass = '';        }
    const label = `📅 ${+m[2]}/${+m[3]} · ${tail}`;
    return { label, klass, days };
  }

  function cyclePriority(current) {
    const order = ['high', 'mid', 'low'];
    const i = order.indexOf(current);
    return order[(i + 1) % order.length] || 'mid';
  }

  const PRIORITY_LABEL = { high: '높음', mid: '중간', low: '낮음' };

  // 카테고리 이름 정규화 + 검증 (trim, 길이, 중복)
  function normalizeCategoryName(raw) {
    const name = String(raw || '').trim();
    if (!name) return { ok: false, reason: '이름이 비어있음' };
    if (name.length > MAX_CATEGORY_LEN) return { ok: false, reason: `${MAX_CATEGORY_LEN}자 이하로 입력` };
    if (state.categories.includes(name)) return { ok: false, reason: '이미 존재하는 카테고리' };
    return { ok: true, name };
  }

  // '기타'를 항상 마지막에 오도록 정렬 (파괴적; 호출자가 저장 책임)
  function reorderCategories() {
    const cats = state.categories;
    const rest = cats.filter((c) => c !== CATEGORY_FALLBACK);
    const hasFallback = cats.includes(CATEGORY_FALLBACK);
    state.categories = hasFallback ? [...rest, CATEGORY_FALLBACK] : rest;
  }

  // 카테고리 색 매핑 보강 — 누락된 항목에 기본/순환 색 할당, 고아 항목 정리
  function ensureCategoryColors() {
    if (!state.categoryColors || typeof state.categoryColors !== 'object') {
      state.categoryColors = {};
    }
    // 기본 카테고리에는 권장색 시드
    state.categories.forEach((cat) => {
      if (state.categoryColors[cat]) return;
      if (DEFAULT_COLOR_FOR[cat]) {
        state.categoryColors[cat] = DEFAULT_COLOR_FOR[cat];
        return;
      }
      // 사용자 추가 카테고리 — 미사용 파스텔 우선, 없으면 순환
      const used = new Set(Object.values(state.categoryColors));
      const fresh = AUTO_PASTEL_CYCLE.find((k) => !used.has(k));
      const idx = state.categories.indexOf(cat);
      state.categoryColors[cat] = fresh || AUTO_PASTEL_CYCLE[idx % AUTO_PASTEL_CYCLE.length];
    });
    // 고아 정리: 카테고리 풀에 없는 매핑 키 제거
    Object.keys(state.categoryColors).forEach((k) => {
      if (!state.categories.includes(k)) delete state.categoryColors[k];
    });
  }

  // 카테고리 색 직접 지정 — 시트의 스와치 클릭 핸들러에서 호출
  function setCategoryColor(cat, key) {
    if (!state.categories.includes(cat)) return;
    if (!SWATCH_KEYS.includes(key)) return;
    state.categoryColors[cat] = key;
    state.colorEditingFor = null;  // 선택 즉시 색 패널 접기
    saveTodos();
    renderCategorySheet();
    render();
    showToast(`${cat} 색상 변경됨`);
  }

  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------- 3) Store ----------
  function loadTodos() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.todos = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.todos)) state.todos = [];
    } catch {
      state.todos = [];
    }
    try {
      const s = localStorage.getItem(SORT_KEY);
      if (s && ['date','due','group','similar','manual'].includes(s)) state.sortMode = s;
    } catch { /* noop */ }
    // 카테고리 풀 로드 — 통합 키(CATS_KEY) 우선, 없으면 구버전 archiveTags 마이그레이션, 그것도 없으면 기본 시드
    let loadedCats = null;
    try {
      const raw = localStorage.getItem(CATS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) {
        loadedCats = parsed.filter((c) => typeof c === 'string' && c.trim());
      }
    } catch { /* noop */ }

    if (!loadedCats) {
      // 구버전 archiveTags가 있으면 기본 카테고리와 합쳐 카테고리 풀로 승격 (사용자가 추가했던 분류 보존)
      let legacyTags = [];
      try {
        const rawLegacy = localStorage.getItem(LEGACY_ATAGS_KEY);
        const parsedLegacy = rawLegacy ? JSON.parse(rawLegacy) : null;
        if (Array.isArray(parsedLegacy)) {
          legacyTags = parsedLegacy.filter((t) => typeof t === 'string' && t.trim());
        }
      } catch { /* noop */ }
      // 중복 제거하면서 합치기 (기본 카테고리 먼저, 그 다음 사용자 태그)
      const merged = [];
      DEFAULT_CATEGORIES.forEach((c) => { if (!merged.includes(c)) merged.push(c); });
      legacyTags.forEach((t) => { if (!merged.includes(t)) merged.push(t); });
      loadedCats = merged;
      // 마이그레이션 표시: 구 키는 다음 save에서 정리됨 (아래에서 명시 삭제)
      try { localStorage.removeItem(LEGACY_ATAGS_KEY); } catch { /* noop */ }
    }
    state.categories = loadedCats;
    if (!state.categories.includes(CATEGORY_FALLBACK)) state.categories.push(CATEGORY_FALLBACK);
    reorderCategories();

    // 카테고리 색 매핑 로드 — 무결성 검증 (등록된 키만 인정)
    try {
      const rawColors = localStorage.getItem(CATCOLORS_KEY);
      const parsedColors = rawColors ? JSON.parse(rawColors) : null;
      if (parsedColors && typeof parsedColors === 'object') {
        const clean = {};
        Object.keys(parsedColors).forEach((k) => {
          if (typeof k === 'string' && SWATCH_KEYS.includes(parsedColors[k])) {
            clean[k] = parsedColors[k];
          }
        });
        state.categoryColors = clean;
      } else {
        state.categoryColors = {};
      }
    } catch { state.categoryColors = {}; }
    ensureCategoryColors();  // 누락된 카테고리에 기본/순환 색 자동 할당

    // 메모 데이터 마이그레이션: archiveTag 필드가 있으면 category로 승격(보관 상태일 때만 의미 있음)
    let migratedCount = 0;
    state.todos.forEach((t) => {
      if (t && t.archiveTag) {
        if (t.status === 'archived') {
          // 사용자가 보관할 때 분류한 값이 우선 — category를 덮어씀
          t.category = t.archiveTag;
          // 카테고리 풀에 없으면 추가
          if (!state.categories.includes(t.category)) {
            const fbIdx = state.categories.indexOf(CATEGORY_FALLBACK);
            if (fbIdx >= 0) state.categories.splice(fbIdx, 0, t.category);
            else state.categories.push(t.category);
          }
          migratedCount++;
        }
        delete t.archiveTag;
      }
    });
    if (migratedCount) reorderCategories();

    try {
      const f = localStorage.getItem(ATAG_KEY);
      if (f && (f === 'all' || state.categories.includes(f))) state.archiveFilter = f;
    } catch { /* noop */ }

    // 마이그레이션 결과(archiveTag→category, 색 매핑 자동 할당, 고아 정리 등) 즉시 영속화
    saveTodos();
  }
  function saveTodos() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
      localStorage.setItem(SORT_KEY, state.sortMode);
      localStorage.setItem(ATAG_KEY, state.archiveFilter);
      localStorage.setItem(CATS_KEY, JSON.stringify(state.categories));
      localStorage.setItem(CATCOLORS_KEY, JSON.stringify(state.categoryColors));
    } catch (e) {
      console.warn('localStorage 저장 실패', e);
    }
  }

  // ---------- 4) Image loader ----------
  function fileToCanvas(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1500;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(blobUrl);
        resolve({ canvas, width: w, height: h });
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('이미지 로드 실패'));
      };
      img.src = blobUrl;
    });
  }

  // 크롭 모달: 소스 캔버스는 그대로 둔 채 선택 상태만 초기화하여 열기
  // 대기열(state.cropQueue)은 유지 — 닫았다 다시 열어도 이어서 추가 가능
  function openCropModal() {
    if (!state.sourceCanvas) return;
    // 캔버스에 소스 재그리기 (크기/내용 동기화 보장)
    el.cropCanvas.width  = state.sourceWidth;
    el.cropCanvas.height = state.sourceHeight;
    el.cropCanvas.getContext('2d').drawImage(state.sourceCanvas, 0, 0);

    resetSelection();
    renderCropQueue();

    el.cropSection.style.display = 'flex';
    el.recropBtn.style.display = 'none';  // 모달 열려있는 동안은 숨김
  }

  function closeCropModal() {
    el.cropSection.style.display = 'none';
  }

  function resetSelection() {
    state.startPx = null;
    state.currentPx = null;
    el.selRect.style.display = 'none';
    el.cropConfirm.disabled = true;
  }

  // 소스 이미지가 남아있는 경우 "추가 크롭" 버튼 노출
  function maybeShowRecropBtn() {
    el.recropBtn.style.display = state.sourceCanvas ? 'block' : 'none';
  }

  async function handleFileSelected(file) {
    setStatus('loading', '이미지 변환 중...');
    // 새 이미지 업로드 시에는 이전 상태(대기열 포함)를 전부 초기화
    el.recropBtn.style.display = 'none';
    state.cropQueue.length = 0;

    try {
      const { canvas, width, height } = await fileToCanvas(file);
      state.sourceCanvas = canvas;
      state.sourceWidth  = width;
      state.sourceHeight = height;

      openCropModal();
      setStatus('', '');
    } catch (e) {
      setStatus('error', e.message || '이미지를 불러올 수 없습니다');
    }
  }

  [el.fileInput, el.cameraInput].forEach((input) => {
    input.addEventListener('change', () => {
      if (input.files[0]) handleFileSelected(input.files[0]);
      input.value = '';
    });
  });

  // ---------- 5) Crop tool (가로줄 선택 모드: 가로 전체, 세로만 드래그) ----------
  // 좌표 기준: cropCanvas의 실제 bounding rect (flex 정렬로 cropWrap과 크기가 다를 수 있음)
  function getPointerPx(e) {
    const r = el.cropCanvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(cx - r.left, r.width)),
      y: Math.max(0, Math.min(cy - r.top,  r.height))
    };
  }

  function updateSelectionOverlay() {
    if (!state.startPx || !state.currentPx) {
      el.selRect.style.display = 'none';
      return;
    }
    // sel-rect는 cropWrap 기준 absolute. 캔버스가 cropWrap 안에서 오프셋될 수 있으므로 보정.
    const canvasRect = el.cropCanvas.getBoundingClientRect();
    const wrapRect   = el.cropWrap.getBoundingClientRect();
    const offsetX = canvasRect.left - wrapRect.left;
    const offsetY = canvasRect.top  - wrapRect.top;

    // 가로는 캔버스 전체 폭 고정, 세로만 드래그 범위
    const y1 = Math.min(state.startPx.y, state.currentPx.y);
    const y2 = Math.max(state.startPx.y, state.currentPx.y);
    const h  = y2 - y1;

    Object.assign(el.selRect.style, {
      left:   offsetX + 'px',
      top:    (offsetY + y1) + 'px',
      width:  canvasRect.width + 'px',
      height: h + 'px',
      display: h > 8 ? 'block' : 'none'
    });
  }

  function onDragStart(e) {
    if (!state.sourceWidth) return;
    state.isDragging = true;
    state.startPx   = getPointerPx(e);
    state.currentPx = null;
    el.cropConfirm.disabled = true;
    el.selRect.style.display = 'none';
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!state.isDragging) return;
    state.currentPx = getPointerPx(e);
    updateSelectionOverlay();
  }
  function onDragEnd() {
    if (!state.isDragging) return;
    state.isDragging = false;
    if (state.startPx && state.currentPx) {
      const dy = Math.abs(state.currentPx.y - state.startPx.y);
      el.cropConfirm.disabled = !(dy > 15);  // 세로 임계치만 검사
    }
  }

  el.cropWrap.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  el.cropWrap.addEventListener('touchstart', onDragStart, { passive: false });
  window.addEventListener('touchmove', onDragMove, { passive: true });
  window.addEventListener('touchend', onDragEnd);

  function cropToDataUrl() {
    if (!state.startPx || !state.currentPx || !state.sourceCanvas) return null;
    // 캔버스 기준으로 픽셀 → 원본 이미지 좌표 스케일 계산
    const canvasRect = el.cropCanvas.getBoundingClientRect();
    const scaleY = state.sourceHeight / canvasRect.height;

    const y1 = Math.round(Math.min(state.startPx.y, state.currentPx.y) * scaleY);
    const y2 = Math.round(Math.max(state.startPx.y, state.currentPx.y) * scaleY);
    const h  = Math.max(0, y2 - y1);
    if (h < 4) return null;

    // 가로는 원본 전체 폭 사용 (가로줄 선택 모드)
    const outCanvas = document.createElement('canvas');
    outCanvas.width  = state.sourceWidth;
    outCanvas.height = h;
    outCanvas.getContext('2d').drawImage(
      state.sourceCanvas,
      0, y1, state.sourceWidth, h,    // src
      0, 0,  state.sourceWidth, h     // dst
    );
    return outCanvas.toDataURL('image/jpeg', 0.88);
  }

  // ----- 크롭 대기열 관리 -----
  function addToQueue(dataUrl) {
    if (!dataUrl) return;
    state.cropQueue.push({
      dataUrl,
      b64: dataUrl.split(',')[1]
    });
    renderCropQueue();
    resetSelection();
    // 재그리기 (선택영역 지워진 상태로 캔버스 유지)
  }

  function removeFromQueue(idx) {
    if (idx < 0 || idx >= state.cropQueue.length) return;
    state.cropQueue.splice(idx, 1);
    renderCropQueue();
  }

  function renderCropQueue() {
    const q = state.cropQueue;
    const box = el.cropQueue;
    if (!q.length) {
      box.classList.remove('has-items');
      box.innerHTML = '';
      el.cropAnalyze.disabled = true;
      el.cropAnalyze.textContent = '분석 시작';
      return;
    }
    box.classList.add('has-items');
    box.innerHTML =
      `<div class="crop-queue-label">대기 ${q.length}개</div>` +
      q.map((it, i) => `
        <div class="crop-thumb" data-idx="${i}">
          <img src="${it.dataUrl}" alt="대기 ${i + 1}번">
          <span class="crop-thumb-idx">#${i + 1}</span>
          <button class="crop-thumb-rm" data-rm="${i}" aria-label="삭제">×</button>
        </div>`).join('');
    el.cropAnalyze.disabled = false;
    el.cropAnalyze.textContent = `분석 시작 (${q.length}개)`;
  }

  // 썸네일의 삭제 버튼 — 이벤트 위임
  el.cropQueue.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    removeFromQueue(parseInt(rm.dataset.rm, 10));
  });

  // ＋ 이 구간 메모로 추가 (가로줄 선택)
  el.cropConfirm.addEventListener('click', () => {
    const dataUrl = cropToDataUrl();
    if (!dataUrl) return;
    addToQueue(dataUrl);
    showToast('대기열에 추가됨 — 계속 드래그해 다음 구간 선택');
  });

  // ＋ 전체 이미지 메모로 추가
  el.cropFull.addEventListener('click', () => {
    if (!state.sourceCanvas) return;
    const dataUrl = state.sourceCanvas.toDataURL('image/jpeg', 0.88);
    addToQueue(dataUrl);
    showToast('전체 이미지 대기열에 추가됨');
  });

  // 닫기 — 모달만 닫음. 소스와 대기열은 유지 (의도적 보존)
  el.cropReset.addEventListener('click', () => {
    closeCropModal();
    maybeShowRecropBtn();
    if (state.cropQueue.length) {
      showToast(`대기열 ${state.cropQueue.length}개 보존됨 — '또 크롭' 눌러 이어서`);
    }
  });

  // 추가 크롭 버튼 — 같은 소스 이미지로 크롭 모달을 다시 연다 (대기열 유지).
  el.recropBtn.addEventListener('click', () => {
    if (!state.sourceCanvas) return;
    openCropModal();
  });

  // ---------- 6) Analyzer ----------
  // 규칙: 1 크롭 = 1 메모. 여러 항목이 보이더라도 하나로 요약·통합.
  const EXTRACTION_PROMPT = [
    '이 이미지(영역)에서 핵심 할일·메모·일정을 딱 하나만 추출해줘.',
    '여러 내용이 보여도 가장 중요한 것 하나로 요약·통합. 임의로 쪼개지 말 것.',
    '(같은 이미지에서 다른 메모가 필요하면 사용자가 다른 구간을 추가 크롭할 예정)',
    '아래 JSON 객체 하나만 반환, 다른 텍스트 금지:',
    '{"text":"내용(50자 이내)","category":"업무|일정|아이디어|연락|쇼핑|기타","priority":"high|mid|low","summary":"이유(15자 이내)"}'
  ].join('\n');

  // AI 응답 → 단일 메모 객체(또는 null)
  function parseResponseJson(raw) {
    try {
      const cleaned = String(raw).replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : cleaned);

      // 구버전/방어: AI가 items 배열로 보냈으면 첫 항목만 채택
      if (Array.isArray(obj.items) && obj.items.length > 0) return obj.items[0];

      // 신버전: 플랫 객체
      if (obj && typeof obj.text === 'string') return obj;

      return null;
    } catch {
      return null;
    }
  }

  // 단일 크롭 → API 호출 → 메모 객체(또는 플레이스홀더) 반환
  async function analyzeOne(b64) {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: b64 }
            },
            { type: 'text', text: EXTRACTION_PROMPT }
          ]
        }]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${res.status}: ${err.error?.message || res.statusText}`);
    }
    const data = await res.json();
    const raw = data.content?.find((c) => c.type === 'text')?.text || '';
    return parseResponseJson(raw);
  }

  // 대기열 일괄 분석 — 병렬 호출 후 메모 N개 한꺼번에 생성
  el.cropAnalyze.addEventListener('click', async () => {
    const q = state.cropQueue;
    if (!q.length) return;
    el.cropAnalyze.disabled = true;
    el.cropConfirm.disabled = true;
    el.cropFull.disabled    = true;
    setStatus('loading', `AI 분석 중... (${q.length}개 병렬)`);

    const results = await Promise.allSettled(q.map((it) => analyzeOne(it.b64)));
    const dateStr = formatDate();

    let okCount = 0;
    let failCount = 0;
    // 첫 번째 크롭이 메모 리스트 최상단이 되도록 역순으로 unshift
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i];
      let item = null;
      if (r.status === 'fulfilled') {
        item = r.value;
        if (item) okCount++; else failCount++;
      } else {
        failCount++;
      }
      state.todos.unshift({
        id: Date.now() + Math.random() + i,
        text:     item?.text     || '분석 실패 — 내용 확인 필요',
        category: item?.category || '기타',
        priority: item?.priority || 'mid',
        summary:  item?.summary  || (item ? '' : '수동확인'),
        date: dateStr,
        status: 'active'
      });
    }

    saveTodos();
    render();
    updateStats();

    // 대기열 비우고 모달 닫기
    state.cropQueue.length = 0;
    renderCropQueue();
    closeCropModal();

    const total = results.length;
    if (failCount === 0) {
      setStatus('success', `메모 ${total}개 생성 완료!`);
      showToast(`띠링! 메모 ${total}개 일괄 생성됨`);
    } else if (okCount > 0) {
      setStatus('success', `${okCount}개 성공, ${failCount}개 수동확인 필요`);
      showToast(`메모 ${total}개 생성 (${failCount}개 확인 필요)`);
    } else {
      setStatus('error', `분석 실패 ${failCount}개 — 메모는 생성되었으니 더블클릭해 수정하세요`);
    }

    el.cropConfirm.disabled = !(state.startPx && state.currentPx);
    el.cropFull.disabled = false;
    maybeShowRecropBtn();
  });

  // ---------- 7) Tabs / Renderer ----------
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.currentTab = tab.dataset.tab;
      // 보관 이외의 탭으로 이동하면 보관 필터는 '전체'로 리셋 (다시 보관 탭 복귀 시 직관적)
      if (state.currentTab !== 'archived') state.archiveFilter = 'all';
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
      tab.classList.add('on');
      render();
    });
  });

  const EMPTY_MESSAGES = {
    active:   { title: '진행중 메모 없음', sub: '이미지를 올려 시작하세요' },
    done:     { title: '완료 없음',       sub: '메모 완료 시 표시됩니다' },
    archived: { title: '보관 없음',       sub: '보관 시 여기에 표시됩니다' }
  };

  function priorityClass(p) {
    if (p === 'high') return 'ph';
    if (p === 'low')  return 'pl';
    return 'pm';
  }

  function emptyStateHtml(tab) {
    const m = EMPTY_MESSAGES[tab] || EMPTY_MESSAGES.active;
    return `
      <div class="empty">
        <div class="eicon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
        </div>
        <div class="etitle">${escapeHtml(m.title)}</div>
        <div class="esub">${escapeHtml(m.sub)}</div>
      </div>`;
  }

  function itemHtml(t) {
    const doneClass    = t.status === 'done' ? ' done' : '';
    const checkedClass = t.status === 'done' ? ' on'   : '';
    const showArchive  = t.status !== 'archived';
    const showRestore  = t.status === 'archived';
    const category     = t.category || '기타';
    const summaryHtml  = t.summary
      ? `<span class="isep">·</span><span class="isummary" title="더블클릭하여 수정">${escapeHtml(t.summary)}</span>`
      : '';
    const di = dueInfo(t.due);
    const dueHtml = di
      ? `<button class="idue ${di.klass}" data-action="due-pick" title="클릭하여 기한 변경">
           ${escapeHtml(di.label)}
           <span class="idue-rm" data-action="due-clear" title="기한 삭제" aria-label="기한 삭제">×</span>
         </button>`
      : `<button class="idue empty" data-action="due-pick" title="클릭하여 기한 설정">기한없음</button>`;
    const prio = t.priority || 'mid';

    return `
      <div class="item${doneClass}" data-id="${escapeHtml(String(t.id))}" draggable="true">
        <div class="imeta-top">
          <span class="idrag" title="드래그로 순서 변경" aria-hidden="true">⋮⋮</span>
          <button class="cb ${catColorClass(category)}" data-action="cat-pick" title="카테고리: ${escapeHtml(category)} · 탭하여 변경" aria-haspopup="listbox">${escapeHtml(category)}</button>
          <span class="isep">·</span>
          <span class="idate">${escapeHtml(t.date || '')}</span>
          ${summaryHtml}
          ${dueHtml}
          <button class="pdot ${priorityClass(prio)}" data-action="prio-cycle" title="우선순위: ${escapeHtml(PRIORITY_LABEL[prio] || prio)} · 클릭하여 변경" aria-label="우선순위 변경"></button>
        </div>
        <div class="imain">
          <button class="ichk${checkedClass}" data-action="toggle" aria-label="완료 토글"></button>
          <div class="ibody">
            <div class="itext" title="더블클릭하여 수정">${escapeHtml(t.text)}</div>
          </div>
          <div class="iacts">
            ${showArchive ? `
              <button class="ab arc" data-action="archive" aria-label="보관">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <polyline points="21 8 21 21 3 21 3 8"/>
                  <rect x="1" y="3" width="22" height="5"/>
                  <line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>` : ''}
            ${showRestore ? `
              <button class="ab" data-action="restore" aria-label="복원">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
                </svg>
              </button>` : ''}
            <button class="ab del" data-action="delete" aria-label="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ----- 정렬 -----
  const PRIORITY_WEIGHT = { high: 0, mid: 1, low: 2 };
  const CATEGORY_ORDER  = ['업무', '일정', '아이디어', '연락', '쇼핑', '기타'];

  function applySort(arr) {
    // 복사 후 정렬 (원본 순서 보존)
    const xs = arr.slice();
    const mode = state.sortMode;

    if (mode === 'manual') {
      // 수동: 저장된 순서 그대로 (state.todos 배열 순서를 그대로 사용)
      return xs;
    }
    if (mode === 'date') {
      // id는 Date.now() + 랜덤이므로 id 내림차순 = 최신 먼저
      return xs.sort((a, b) => Number(b.id) - Number(a.id));
    }
    if (mode === 'group') {
      return xs.sort((a, b) => {
        const ca = CATEGORY_ORDER.indexOf(a.category || '기타');
        const cb = CATEGORY_ORDER.indexOf(b.category || '기타');
        if (ca !== cb) return ca - cb;
        return Number(b.id) - Number(a.id);
      });
    }
    if (mode === 'similar') {
      // 같은 카테고리 + 비슷한 우선순위를 인접하게
      return xs.sort((a, b) => {
        const ca = CATEGORY_ORDER.indexOf(a.category || '기타');
        const cb = CATEGORY_ORDER.indexOf(b.category || '기타');
        if (ca !== cb) return ca - cb;
        const pa = PRIORITY_WEIGHT[a.priority] ?? 1;
        const pb = PRIORITY_WEIGHT[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        return Number(b.id) - Number(a.id);
      });
    }
    if (mode === 'due') {
      // 기한 있는 것을 앞으로, 가까운 기한부터. 기한 없는 것은 뒤로 최신순.
      return xs.sort((a, b) => {
        const da = a.due || '';
        const db = b.due || '';
        if (da && db) return da < db ? -1 : da > db ? 1 : 0;
        if (da && !db) return -1;
        if (!da && db) return 1;
        return Number(b.id) - Number(a.id);
      });
    }
    return xs;
  }

  // ----- 기한 입력 (공용 input[type=date]의 showPicker) -----
  let pendingDueTodoId = null;
  function openDatePicker(todoId, currentIso) {
    pendingDueTodoId = String(todoId);
    el.dateHelper.value = currentIso || '';
    const trigger = () => {
      if (typeof el.dateHelper.showPicker === 'function') {
        try { el.dateHelper.showPicker(); return; } catch {}
      }
      // fallback: focus/click (모바일 및 구 브라우저)
      el.dateHelper.focus();
      el.dateHelper.click();
    };
    trigger();
  }
  el.dateHelper.addEventListener('change', () => {
    const id = pendingDueTodoId;
    pendingDueTodoId = null;
    if (!id) return;
    const todo = state.todos.find((t) => String(t.id) === id);
    if (!todo) return;
    todo.due = el.dateHelper.value || null;
    saveTodos();
    render();
    updateStats();
    if (todo.due) showToast(`기한 설정: ${todo.due}`);
  });

  function render() {
    const list = el.itemList;
    let filtered = state.todos.filter((t) => t.status === state.currentTab);

    // 보관 탭에서만 카테고리 필터 적용 (통합 category 필드 기준)
    if (state.currentTab === 'archived' && state.archiveFilter !== 'all') {
      filtered = filtered.filter((t) => (t.category || CATEGORY_FALLBACK) === state.archiveFilter);
    }

    renderArchiveTagBar();  // 보관 탭일 때만 내부에서 보임

    const sorted = applySort(filtered);
    if (!sorted.length) {
      list.innerHTML = emptyStateHtml(state.currentTab);
      return;
    }
    list.innerHTML = sorted.map(itemHtml).join('');
  }

  // 보관 탭 전용 카테고리 필터 바 — 순수 필터링 전용 (카테고리 추가/삭제/순서는 바텀시트에서)
  function renderArchiveTagBar() {
    const bar = el.atagBar;
    if (!bar) return;
    if (state.currentTab !== 'archived') {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;

    // 개수 집계 (보관 상태 메모만 대상, category 필드 기준)
    const archived = state.todos.filter((t) => t.status === 'archived');
    const counts = { all: archived.length };
    state.categories.forEach((c) => { counts[c] = 0; });
    archived.forEach((t) => {
      const c = t.category || CATEGORY_FALLBACK;
      counts[c] = (counts[c] || 0) + 1;
    });

    // 전체 + 각 카테고리 pill
    const parts = [
      `<button class="atag-pill${state.archiveFilter === 'all' ? ' on' : ''}" data-atag="all">
         전체<span class="atag-n">${counts.all}</span>
       </button>`
    ];
    state.categories.forEach((cat) => {
      const isOn = state.archiveFilter === cat;
      parts.push(`
        <button class="atag-pill ${catColorClass(cat)}${isOn ? ' on' : ''}" data-atag="${escapeHtml(cat)}">
          ${escapeHtml(cat)}<span class="atag-n">${counts[cat] || 0}</span>
        </button>`);
    });

    bar.innerHTML = `<span class="atag-label">카테고리</span>` + parts.join('');
  }

  function deleteCategory(cat) {
    if (cat === CATEGORY_FALLBACK) return;  // 기타는 삭제 불가
    // 해당 카테고리를 쓰는 메모 (전체 탭 기준 — 메모는 어디서든 영향받음)
    const affected = state.todos.filter((t) => (t.category || CATEGORY_FALLBACK) === cat);
    const msg = affected.length
      ? `'${cat}' 카테고리를 삭제하시겠습니까?\n이 카테고리 메모 ${affected.length}개는 '기타'로 이관됩니다.`
      : `'${cat}' 카테고리를 삭제하시겠습니까?`;
    if (!window.confirm(msg)) return;

    affected.forEach((t) => { t.category = CATEGORY_FALLBACK; });
    state.categories = state.categories.filter((x) => x !== cat);
    delete state.categoryColors[cat];     // 색 매핑도 함께 정리
    if (state.colorEditingFor === cat) state.colorEditingFor = null;
    if (state.archiveFilter === cat) state.archiveFilter = 'all';
    saveTodos();
    render();
    showToast(affected.length ? `카테고리 삭제, 메모 ${affected.length}개 '기타'로 이관` : '카테고리 삭제됨');
  }

  // ===== 카테고리 바텀시트 피커 =====
  // 메모 헤더의 .cb 칩을 탭 → 화면 하단에서 슬라이드 업 → 항목을 직접 탭하여 선택
  function openCategoryPicker(todoId) {
    state.pickerTodoId = String(todoId);
    state.pickerAdding = false;
    renderCategorySheet();
    el.catSheetBackdrop.hidden = false;
    el.catSheet.hidden = false;
    // 다음 프레임에 .open 클래스를 붙여 슬라이드업 트랜지션 발화
    requestAnimationFrame(() => {
      el.catSheetBackdrop.classList.add('open');
      el.catSheet.classList.add('open');
    });
  }

  function closeCategoryPicker() {
    state.pickerTodoId = null;
    state.pickerAdding = false;
    state.colorEditingFor = null;  // 색 패널도 함께 접기
    el.catSheetBackdrop.classList.remove('open');
    el.catSheet.classList.remove('open');
    // 트랜지션 끝나고 hidden 처리 (CSS transition: ~180ms와 맞춤)
    setTimeout(() => {
      if (state.pickerTodoId === null) {
        el.catSheetBackdrop.hidden = true;
        el.catSheet.hidden = true;
        el.catSheetList.innerHTML = '';
      }
    }, 220);
  }

  // 한 카테고리의 스와치 패널 (파스텔 6 + 볼드 6 = 12개) HTML
  function swatchPanelHtml(cat) {
    const name = escapeHtml(cat);
    const currentKey = state.categoryColors[cat] || '';
    const dot = (key) => {
      const isOn = key === currentKey;
      return `<button class="swatch cat-${key}${isOn ? ' on' : ''}"
                       data-cat-set-color="${name}|${key}"
                       aria-label="${name} 색상 ${key}"
                       title="${key}"></button>`;
    };
    return `
      <div class="cat-sheet-swatches" role="group" aria-label="${name} 색상 선택">
        <div class="swatch-row">
          <span class="swatch-label">파스텔</span>
          <span class="swatch-grid">${PASTEL_KEYS.map(dot).join('')}</span>
        </div>
        <div class="swatch-row">
          <span class="swatch-label">볼드</span>
          <span class="swatch-grid">${BOLD_KEYS.map(dot).join('')}</span>
        </div>
      </div>`;
  }

  function renderCategorySheet() {
    const list = el.catSheetList;
    if (!list) return;
    const todo = state.todos.find((t) => String(t.id) === state.pickerTodoId);
    const current = todo ? (todo.category || CATEGORY_FALLBACK) : null;

    // 재정렬 가능 범위 — '기타'는 항상 마지막 고정이므로 일반 카테고리만 대상
    const generals = state.categories.filter((c) => c !== CATEGORY_FALLBACK);

    const rows = state.categories.map((cat) => {
      const isOn = cat === current;
      const isFallback = cat === CATEGORY_FALLBACK;
      const isEditingColor = state.colorEditingFor === cat;
      const name = escapeHtml(cat);
      const idx = generals.indexOf(cat);
      const canUp   = !isFallback && idx > 0;
      const canDown = !isFallback && idx >= 0 && idx < generals.length - 1;

      // '기타'는 ↑↓×는 없음(순서 고정, 삭제 불가). 색 변경은 모든 카테고리에 허용.
      const controls = isFallback ? '' : `
        <span class="cat-sheet-ctrls" aria-label="${name} 관리">
          <button class="cat-sheet-mv" data-cat-up="${name}" aria-label="위로" title="위로"${canUp ? '' : ' disabled'}>↑</button>
          <button class="cat-sheet-mv" data-cat-down="${name}" aria-label="아래로" title="아래로"${canDown ? '' : ' disabled'}>↓</button>
          <button class="cat-sheet-del" data-cat-del="${name}" aria-label="삭제" title="삭제">×</button>
        </span>`;

      // 색 도트 = 별도 버튼 (탭하면 아래로 스와치 패널 펼침)
      // 행 본체 버튼 = 카테고리 선택
      return `
        <div class="cat-sheet-rowwrap${isEditingColor ? ' editing-color' : ''}">
          <div class="cat-sheet-row${isOn ? ' on' : ''}" role="option" aria-selected="${isOn}">
            <button class="cat-sheet-dotbtn${isEditingColor ? ' on' : ''}"
                    data-cat-color="${name}"
                    aria-label="${name} 색 변경"
                    aria-expanded="${isEditingColor}"
                    title="색상 변경">
              <span class="cat-sheet-dot ${catColorClass(cat)}" aria-hidden="true"></span>
            </button>
            <button class="cat-sheet-item" data-cat-pick="${name}">
              <span class="cat-sheet-name">${name}</span>
              ${isOn ? '<span class="cat-sheet-check" aria-hidden="true">✓</span>' : ''}
            </button>
            ${controls}
          </div>
          ${isEditingColor ? swatchPanelHtml(cat) : ''}
        </div>`;
    });

    if (state.pickerAdding) {
      rows.push(`
        <div class="cat-sheet-addrow">
          <input type="text" class="cat-sheet-addinput" id="catSheetAddInput"
                 maxlength="${MAX_CATEGORY_LEN}" placeholder="새 카테고리명"
                 autocomplete="off" autocapitalize="off">
          <button class="cat-sheet-addok" data-cat-add-ok>추가</button>
          <button class="cat-sheet-addcancel" data-cat-add-cancel>취소</button>
        </div>`);
    } else {
      rows.push(`
        <button class="cat-sheet-item cat-sheet-add" data-cat-add>
          <span class="cat-sheet-dot cat-sheet-dot-add" aria-hidden="true">＋</span>
          <span class="cat-sheet-name">새 카테고리 추가</span>
        </button>`);
    }

    list.innerHTML = rows.join('');

    if (state.pickerAdding) {
      const input = document.getElementById('catSheetAddInput');
      if (input) {
        input.focus();
        input.addEventListener('keydown', onPickerAddKey);
      }
    }
  }

  // 카테고리 순서 이동 — '기타'는 이동 대상 아님
  function moveCategory(cat, dir) {
    if (cat === CATEGORY_FALLBACK) return;
    const cats = state.categories.slice();
    const i = cats.indexOf(cat);
    if (i < 0) return;
    const j = i + dir;  // dir: -1 = 위, +1 = 아래
    if (j < 0 || j >= cats.length) return;
    // '기타' 자리를 넘어갈 수 없음
    if (cats[j] === CATEGORY_FALLBACK) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    state.categories = cats;
    reorderCategories();
    saveTodos();
    renderCategorySheet();
    render();  // 메모 목록의 칩 색상이 팔레트 인덱스 기반이라 재렌더
  }

  function onPickerAddKey(ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitPickerAdd(ev.target.value);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelPickerAdd();
    }
  }

  function selectCategoryFromPicker(cat) {
    const todo = state.todos.find((t) => String(t.id) === state.pickerTodoId);
    if (!todo) { closeCategoryPicker(); return; }
    if (!state.categories.includes(cat)) {
      // 풀에 없는 카테고리는 폴백으로
      cat = CATEGORY_FALLBACK;
    }
    todo.category = cat;
    saveTodos();
    closeCategoryPicker();
    render();
    showToast(`카테고리: ${cat}`);
  }

  function beginPickerAdd() {
    state.pickerAdding = true;
    renderCategorySheet();
  }
  function cancelPickerAdd() {
    state.pickerAdding = false;
    renderCategorySheet();
  }
  function commitPickerAdd(raw) {
    const v = normalizeCategoryName(raw);
    if (!v.ok) {
      showToast(`추가 실패: ${v.reason}`);
      const input = document.getElementById('catSheetAddInput');
      if (input) input.focus();
      return;
    }
    // 풀에 삽입 (기타 앞)
    const fallbackIdx = state.categories.indexOf(CATEGORY_FALLBACK);
    if (fallbackIdx >= 0) state.categories.splice(fallbackIdx, 0, v.name);
    else state.categories.push(v.name);
    reorderCategories();
    ensureCategoryColors();  // 새 카테고리에 자동 색 할당
    state.pickerAdding = false;
    // 새로 만든 카테고리를 곧바로 현재 메모에 적용 + 닫기
    selectCategoryFromPicker(v.name);
    showToast(`카테고리 추가 → ${v.name}`);
  }

  // 시트 위임 클릭 — 우선순위: 스와치 선택 > 색 토글 > 이동/삭제 > 추가 입력 > 카테고리 선택
  el.catSheet.addEventListener('click', (e) => {
    // 1) 스와치 선택 — "카테고리|색키" 포맷
    const swatch = e.target.closest('[data-cat-set-color]');
    if (swatch) {
      const [cat, key] = swatch.dataset.catSetColor.split('|', 2);
      setCategoryColor(cat, key);
      return;
    }

    // 2) 색 도트 버튼 — 스와치 패널 토글 (같은 카테고리 다시 누르면 접힘)
    const dotBtn = e.target.closest('[data-cat-color]');
    if (dotBtn) {
      const cat = dotBtn.dataset.catColor;
      state.colorEditingFor = (state.colorEditingFor === cat) ? null : cat;
      renderCategorySheet();
      return;
    }

    // 3) 위로/아래로 이동
    const up = e.target.closest('[data-cat-up]');
    if (up) { moveCategory(up.dataset.catUp, -1); return; }
    const dn = e.target.closest('[data-cat-down]');
    if (dn) { moveCategory(dn.dataset.catDown, +1); return; }

    // 4) × 삭제 (confirm 내장)
    const del = e.target.closest('[data-cat-del]');
    if (del) {
      deleteCategory(del.dataset.catDel);
      // 삭제 후에도 시트는 열려 있는 상태로 — 다시 렌더
      if (state.pickerTodoId !== null) renderCategorySheet();
      return;
    }

    // 5) + 추가 입력 행
    if (e.target.closest('[data-cat-add-ok]')) {
      const input = document.getElementById('catSheetAddInput');
      commitPickerAdd(input ? input.value : '');
      return;
    }
    if (e.target.closest('[data-cat-add-cancel]')) {
      cancelPickerAdd();
      return;
    }
    if (e.target.closest('[data-cat-add]')) {
      beginPickerAdd();
      return;
    }

    // 6) 행 본체 탭 = 카테고리 선택 + 닫기
    const pick = e.target.closest('[data-cat-pick]');
    if (pick) {
      selectCategoryFromPicker(pick.dataset.catPick);
      return;
    }
  });

  // 닫기 컨트롤
  el.catSheetClose.addEventListener('click', closeCategoryPicker);
  el.catSheetBackdrop.addEventListener('click', closeCategoryPicker);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.pickerTodoId !== null) {
      closeCategoryPicker();
    }
  });

  // ----- 정렬 버튼 바 -----
  function syncSortButtons() {
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.sort === state.sortMode);
    });
  }

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sortMode = btn.dataset.sort;
      syncSortButtons();
      saveTodos();  // sortMode 영속화
      render();
    });
  });

  // ----- 드래그 앤 드롭 (순서 변경 → 자동으로 수동 모드로 전환) -----
  el.itemList.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.item');
    if (!item) return;
    // 편집 중이면 드래그 차단
    if (item.querySelector('.editing')) {
      e.preventDefault();
      return;
    }
    state.dragId = item.dataset.id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', state.dragId); } catch {}
  });

  el.itemList.addEventListener('dragend', (e) => {
    const item = e.target.closest('.item');
    if (item) item.classList.remove('dragging');
    document.querySelectorAll('.item.drag-over').forEach((n) => n.classList.remove('drag-over'));
    state.dragId = null;
  });

  el.itemList.addEventListener('dragover', (e) => {
    if (!state.dragId) return;
    const over = e.target.closest('.item');
    if (!over || over.dataset.id === state.dragId) return;
    e.preventDefault();  // drop 허용
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.item.drag-over').forEach((n) => {
      if (n !== over) n.classList.remove('drag-over');
    });
    over.classList.add('drag-over');
  });

  el.itemList.addEventListener('drop', (e) => {
    e.preventDefault();
    const over = e.target.closest('.item');
    const draggedId = state.dragId;
    if (!over || !draggedId || over.dataset.id === draggedId) return;

    // 드래그하는 순간 자동으로 '수동' 정렬 모드로 전환
    state.sortMode = 'manual';
    syncSortButtons();

    // state.todos 에서 위치 바꾸기 (현재 보이는 순서 기준으로 재배열 후 저장)
    const visibleIds = Array.from(el.itemList.querySelectorAll('.item'))
      .map((n) => n.dataset.id);

    const fromIdx = visibleIds.indexOf(draggedId);
    const toIdx   = visibleIds.indexOf(over.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return;

    // 현재 화면 순서 재정의
    const newVisibleIds = visibleIds.slice();
    newVisibleIds.splice(fromIdx, 1);
    newVisibleIds.splice(toIdx, 0, draggedId);

    // state.todos 를 재배열: 보이는 메모들은 새 순서로, 나머지(다른 탭)는 뒤에 붙임
    const visibleSet = new Set(newVisibleIds);
    const hidden = state.todos.filter((t) => !visibleSet.has(String(t.id)));
    const byId = new Map(state.todos.map((t) => [String(t.id), t]));
    state.todos = newVisibleIds.map((id) => byId.get(id)).concat(hidden);

    saveTodos();
    render();
    showToast('순서 변경 — 수동 정렬 모드로 전환');
  });

  // 체크/삭제/보관/복원 — 이벤트 위임
  el.itemList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const itemEl = btn.closest('.item');
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    const todo = state.todos.find((t) => String(t.id) === String(id));
    if (!todo) return;

    const action = btn.dataset.action;

    // 우선순위 클릭 → 순환 변경 (high → mid → low → high)
    if (action === 'prio-cycle') {
      todo.priority = cyclePriority(todo.priority || 'mid');
      saveTodos();
      render();
      showToast(`우선순위: ${PRIORITY_LABEL[todo.priority]}`);
      return;
    }

    // 기한 삭제 (× 버튼) — due-pick 버블링 차단
    if (action === 'due-clear') {
      e.stopPropagation();
      todo.due = null;
      saveTodos();
      render();
      showToast('기한 삭제됨');
      return;
    }

    // 기한 설정/변경 — 네이티브 캘린더 열기 (render 금지: 입력 후 change 이벤트에서 처리)
    if (action === 'due-pick') {
      openDatePicker(todo.id, todo.due);
      return;
    }

    // 카테고리 변경 — 바텀시트 피커 열기 (탭/클릭으로 직접 선택)
    if (action === 'cat-pick') {
      openCategoryPicker(todo.id);
      return;
    }

    if (action === 'toggle') {
      todo.status = todo.status === 'done' ? 'active' : 'done';
    } else if (action === 'archive') {
      todo.status = 'archived';
    } else if (action === 'restore') {
      todo.status = 'active';
    } else if (action === 'delete') {
      state.todos = state.todos.filter((t) => String(t.id) !== String(id));
    }

    saveTodos();
    render();
    updateStats();
  });

  // 더블클릭 인라인 편집 — 본문 텍스트(.itext) / 요약(.isummary)
  el.itemList.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.itext');
    if (textEl) return startInlineEdit(textEl, 'text');
    const summaryEl = e.target.closest('.isummary');
    if (summaryEl) return startInlineEdit(summaryEl, 'summary');
  });

  function startInlineEdit(elem, field) {
    if (elem.dataset.editing === '1') return;  // 중복 진입 방지
    const itemEl = elem.closest('.item');
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    const todo = state.todos.find((t) => String(t.id) === String(id));
    if (!todo) return;

    const original = String(todo[field] || '');
    elem.dataset.editing = '1';
    elem.contentEditable = 'true';
    elem.spellcheck = true;
    elem.classList.add('editing');
    elem.textContent = original;         // 요약의 "· " 접두어를 걷어내고 순수 값만 편집
    elem.focus();

    // 전체 텍스트 선택
    const range = document.createRange();
    range.selectNodeContents(elem);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let finalized = false;
    const finish = (save) => {
      if (finalized) return;
      finalized = true;
      elem.contentEditable = 'false';
      elem.dataset.editing = '';
      elem.classList.remove('editing');
      elem.removeEventListener('keydown', onKey);
      elem.removeEventListener('blur', onBlur);

      if (save) {
        const newVal = (elem.textContent || '').trim();
        if (newVal && newVal !== original) {
          todo[field] = newVal;
          saveTodos();
        } else if (!newVal) {
          // 비워버린 경우는 원복
          todo[field] = original;
        }
      } else {
        todo[field] = original;
      }
      render();  // 접두어(· ) 복원 및 이스케이프 재적용 위해 재렌더
    };

    const onKey = (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);

    elem.addEventListener('keydown', onKey);
    elem.addEventListener('blur', onBlur);
  }

  // ---------- 7b) Stat cards jump + Archive tag filter pills ----------
  // 현황 카드(진행중/완료/보관) 클릭 → 해당 탭으로 이동
  document.querySelectorAll('[data-jump]').forEach((card) => {
    card.addEventListener('click', () => {
      const target = card.dataset.jump;
      if (!target) return;
      state.currentTab = target;
      // 현황 카드에서 점프할 때는 보관 필터를 '전체'로 (신선한 뷰 제공)
      state.archiveFilter = 'all';
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('on', t.dataset.tab === target);
      });
      render();
    });
  });

  // 보관 카테고리 필터 바 — 순수 필터링 전용 (추가/삭제/순서는 바텀시트 피커에서)
  el.atagBar.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-atag]');
    if (!pill) return;
    state.archiveFilter = pill.dataset.atag;
    saveTodos();
    render();
  });

  // ---------- 8) Stats / Init ----------
  function updateStats() {
    const s = state.todos;
    el.stats.total.textContent    = s.length;
    el.stats.done.textContent     = s.filter((t) => t.status === 'done').length;
    el.stats.progress.textContent = s.filter((t) => t.status === 'active').length;
    el.stats.archived.textContent = s.filter((t) => t.status === 'archived').length;
  }

  loadTodos();
  syncSortButtons();
  render();
  updateStats();
})();
