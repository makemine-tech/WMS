/* 메이크창고 비서 확장 — 헤드비서 페이지에 확장 판을 알려 준다 (2026-11-01) */
document.documentElement.dataset.mkwExt = chrome.runtime.getManifest().version;
/* 페이지 ↔ 확장 다리: 우체국 대신 조회 */
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.to !== 'mkwExtEpost') return;
  const id = e.data.id;
  chrome.runtime.sendMessage({ epost: e.data.no }, (r) => {
    window.postMessage({ to: 'mkwPageEpost', id, res: r || { err: (chrome.runtime.lastError && chrome.runtime.lastError.message) || '확장 응답 없음' } }, location.origin);
  });
});
