/* ===========================================================
   반품 검수 「알바용 링크」 — 로그인 없이 링크(열쇠)로 들어오기 (대표님 2026-10-24)

   PC 반품입고관리에서 링크를 여러 개 만들 수 있음: retKeyIndex/{열쇠} = { gid, db:'star'|'cargo', label, exp, off, at, by }
   휴대폰(star_return_m.html?key=열쇠)은 이름 없는 임시 계정(익명 로그인)으로 접속한 뒤 이 함수를 부름
     입력 { key, name }  →  열쇠가 살아 있으면 retKiosk/{uid} = { gid, db, key, name, at } 를 써 줌
   DB 규칙이 retKiosk 를 보고 그 계정에 「그 그룹의 그 반품 데이터(star_return 또는 cargo_return)」만 읽고 쓰게 해 줌.
   링크를 끄거나(off) 기간이 지나면(exp) 규칙에서 바로 막힘 — 이미 들어와 있던 휴대폰도.
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

/* 열쇠가 살아 있는지 — epost.js 도 씀 */
async function liveKey(key){
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(key || ''))) return null;
  const k = (await admin.database().ref('retKeyIndex/' + key).once('value')).val();
  if (!k || k.off || (k.exp && Date.now() > k.exp)) return null;
  return k;
}
exports.liveKey = liveKey;

exports.retKioskJoin = onCall({ region: 'asia-northeast3', memory: '256MiB' }, async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '접속 준비가 안 됐습니다 — 다시 열어 주세요');
  const key = String((req.data && req.data.key) || '');
  const k = await liveKey(key);
  if (!k) throw new HttpsError('permission-denied', '링크가 꺼졌거나 기간이 끝났습니다 — 관리자에게 새 링크를 받으세요');
  const name = String((req.data && req.data.name) || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20) || '작업자';
  await admin.database().ref('retKiosk/' + uid).set({ gid: k.gid, db: k.db, key, name, at: Date.now() });
  await admin.database().ref('retKeyIndex/' + key + '/used/' + uid).set({ name, at: Date.now() });
  logger.info('retKioskJoin', { db: k.db, label: k.label || '', name });
  return { ok: true, gid: k.gid, db: k.db, label: k.label || '', exp: k.exp || null };
});
