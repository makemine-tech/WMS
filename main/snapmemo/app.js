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

    // 분석할 이미지 원본
    sourceCanvas: null,
    sourceWidth: 0,
    sourceHeight: 0,
    finalImageB64: null,

    // 크롭 드래그 상태 (cropWrap 기준 픽셀 좌표)
    isDragging: false,
    startPx: null,   // { x, y }
    currentPx: null  // { x, y }
  };

  const STORAGE_KEY = 'snapmemo.todos.v5';

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
    cropReset:   $('cropReset'),
    previewBox:  $('prevBox'),
    previewImg:  $('prevImg'),
    removeBtn:   $('rmBtn'),
    analyzeBtn:  $('analyzeBtn'),
    statusBox:   $('statusBox'),
    toast:       $('toast'),
    itemList:    $('itemList'),
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
  }
  function saveTodos() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
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

  async function handleFileSelected(file) {
    setStatus('loading', '이미지 변환 중...');
    el.analyzeBtn.style.display = 'none';
    el.previewBox.style.display = 'none';
    el.cropSection.style.display = 'none';

    try {
      const { canvas, width, height } = await fileToCanvas(file);
      state.sourceCanvas = canvas;
      state.sourceWidth  = width;
      state.sourceHeight = height;

      el.cropCanvas.width  = width;
      el.cropCanvas.height = height;
      el.cropCanvas.getContext('2d').drawImage(canvas, 0, 0);

      el.cropSection.style.display = 'flex';
      state.startPx = null;
      state.currentPx = null;
      el.selRect.style.display = 'none';
      el.cropConfirm.disabled = true;
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

  el.cropConfirm.addEventListener('click', () => {
    const dataUrl = cropToDataUrl();
    if (!dataUrl) return;
    state.finalImageB64 = dataUrl.split(',')[1];
    el.previewImg.src = dataUrl;
    el.previewBox.style.display = 'block';
    el.cropSection.style.display = 'none';
    setStatus('success', '영역 선택 완료');
    el.analyzeBtn.style.display = 'block';
  });

  el.cropFull.addEventListener('click', () => {
    if (!state.sourceCanvas) return;
    const dataUrl = state.sourceCanvas.toDataURL('image/jpeg', 0.88);
    state.finalImageB64 = dataUrl.split(',')[1];
    el.previewImg.src = dataUrl;
    el.previewBox.style.display = 'block';
    el.cropSection.style.display = 'none';
    setStatus('success', '전체 이미지 준비 완료');
    el.analyzeBtn.style.display = 'block';
  });

  el.cropReset.addEventListener('click', resetImageState);
  el.removeBtn.addEventListener('click', () => {
    el.previewBox.style.display = 'none';
    el.analyzeBtn.style.display = 'none';
    state.finalImageB64 = null;
    setStatus('', '');
  });

  function resetImageState() {
    el.cropSection.style.display = 'none';
    el.previewBox.style.display = 'none';
    el.analyzeBtn.style.display = 'none';
    state.finalImageB64 = null;
    state.sourceCanvas  = null;
    state.sourceWidth   = 0;
    state.sourceHeight  = 0;
    state.startPx = null;
    state.currentPx = null;
    setStatus('', '');
  }

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

  el.analyzeBtn.addEventListener('click', async () => {
    if (!state.finalImageB64) return;
    el.analyzeBtn.disabled = true;
    setStatus('loading', 'AI 분석 중...');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: state.finalImageB64
                }
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
      const item = parseResponseJson(raw);
      const dateStr = formatDate();

      // 1 크롭 = 1 메모. 파싱 실패해도 플레이스홀더 1개 생성 → 사용자가 더블클릭 편집
      const memo = {
        id: Date.now() + Math.random(),
        text:     item?.text     || '분석 완료 — 내용 확인 필요',
        category: item?.category || '기타',
        priority: item?.priority || 'mid',
        summary:  item?.summary  || (item ? '' : '수동확인'),
        date: dateStr,
        status: 'active'
      };
      state.todos.unshift(memo);

      saveTodos();
      render();
      updateStats();

      if (item) {
        setStatus('success', '메모 1개 생성!');
        showToast('띠링! 메모 1개 생성됨');
      } else {
        setStatus('success', '메모 생성 — 내용 확인 필요');
        showToast('띠링! 메모 생성됨 (수동 확인 필요)');
      }

      el.previewBox.style.display = 'none';
      el.analyzeBtn.style.display = 'none';
      state.finalImageB64 = null;
    } catch (e) {
      setStatus('error', '오류: ' + (e.message || e));
    } finally {
      el.analyzeBtn.disabled = false;
    }
  });

  // ---------- 7) Tabs / Renderer ----------
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.currentTab = tab.dataset.tab;
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

    return `
      <div class="item${doneClass}" data-id="${escapeHtml(String(t.id))}">
        <span class="pdot ${priorityClass(t.priority)}" title="${escapeHtml(t.priority || 'mid')}"></span>
        <button class="ichk${checkedClass}" data-action="toggle" aria-label="완료 토글"></button>
        <div class="ibody">
          <div class="itext" title="더블클릭하여 수정">${escapeHtml(t.text)}</div>
          <div class="imeta">
            <span class="cb c${escapeHtml(category)}">${escapeHtml(category)}</span>
            <span class="idate">${escapeHtml(t.date || '')}</span>
            ${t.summary ? `<span class="idate isummary" title="더블클릭하여 수정">· ${escapeHtml(t.summary)}</span>` : ''}
          </div>
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
      </div>`;
  }

  function render() {
    const list = el.itemList;
    const filtered = state.todos.filter((t) => t.status === state.currentTab);
    if (!filtered.length) {
      list.innerHTML = emptyStateHtml(state.currentTab);
      return;
    }
    list.innerHTML = filtered.map(itemHtml).join('');
  }

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

  // ---------- 8) Stats / Init ----------
  function updateStats() {
    const s = state.todos;
    el.stats.total.textContent    = s.length;
    el.stats.done.textContent     = s.filter((t) => t.status === 'done').length;
    el.stats.progress.textContent = s.filter((t) => t.status === 'active').length;
    el.stats.archived.textContent = s.filter((t) => t.status === 'archived').length;
  }

  loadTodos();
  render();
  updateStats();
})();
