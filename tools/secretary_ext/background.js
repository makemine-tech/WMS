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

/* 우체국 대신 조회 — 서버(서울)→우체국이 막힐 때 헤드비서 탭이 부름 (2026-11-01). 페이지는 CORS 로 못 읽어서 확장이 읽는다. 등기번호 숫자만 받음 */
function epostText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(td|th|tr|p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n');
}
async function epost(no) {
  if (!/^\d{10,15}$/.test(String(no))) return { err: '등기번호 형식' };
  try {
    const r = await fetch('https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?displayHeader=N&sid1=' + no, { credentials: 'omit', signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { err: 'http ' + r.status };
    return { text: epostText(await r.text()) };
  } catch (e) { return { err: String((e && e.message) || e).slice(0, 120) }; }
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !m.epost || !String(sender.url || '').startsWith('https://makewon.com/secretary.html')) return;
  epost(m.epost).then(reply);
  return true;
});

/* 확장을 다시 불러오면 열린 탭의 mark.js 가 끊겨 새로고침해야 다시 이어짐 */
async function reloadRunnerTab() {
  const tabs = await chrome.tabs.query({ url: 'https://makewon.com/*' });
  const tab = tabs.find((t) => isRunnerUrl(t.url || t.pendingUrl));
  if (tab) await chrome.tabs.reload(tab.id);
}

chrome.runtime.onStartup.addListener(tick);
chrome.runtime.onInstalled.addListener(async (d) => {
  await tick();
  if (d && d.reason === 'update') { try { await reloadRunnerTab(); } catch (e) { console.warn('헤드비서 탭 새로고침 실패', e); } }
});
chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(tick);
