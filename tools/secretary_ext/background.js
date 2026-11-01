/* 메이크창고 비서 확장 — 헤드비서 탭 유지와 새 판 반영 (2026-11-01)
   비서 전용 크롬 프로필에만 설치한다. 대표님이 쓰는 다른 크롬에는 넣지 않는다. */
const RUN_URL = 'https://makewon.com/secretary.html?run=1';

/* WMS 로그인이 풀리면 헤드비서 탭은 로그인 화면으로 넘어간다. 그 탭도 헤드비서로 쳐야 탭이 늘어나지 않음 */
function isRunnerUrl(url) {
  let u = url || '';
  try { u = decodeURIComponent(u); } catch (e) {}
  return u.includes('secretary.html?run=1');
}

async function keepRunnerTab() {
  const tabs = await chrome.tabs.query({ url: 'https://makewon.com/*' });
  const tab = tabs.find((t) => isRunnerUrl(t.url || t.pendingUrl));
  if (tab) {
    if (tab.autoDiscardable !== false) await chrome.tabs.update(tab.id, { autoDiscardable: false });
    return;
  }
  const made = await chrome.tabs.create({ url: RUN_URL, pinned: true, active: false });
  await chrome.tabs.update(made.id, { autoDiscardable: false });
}

/* 크롬 지킴이가 새 파일을 복사해 두면, 디스크의 판이 달라진 것을 보고 스스로 다시 불러온다 */
async function reloadIfUpdated() {
  const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
  const disk = await res.json();
  if (disk.version !== chrome.runtime.getManifest().version) chrome.runtime.reload();
}

async function tick() {
  try { await reloadIfUpdated(); } catch (e) { console.warn('판 확인 실패', e); }
  try { await keepRunnerTab(); } catch (e) { console.warn('헤드비서 탭 확인 실패', e); }
}

chrome.runtime.onStartup.addListener(tick);
chrome.runtime.onInstalled.addListener(tick);
chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(tick);
