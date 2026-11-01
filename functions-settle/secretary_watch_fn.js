/* 전담비서 생존 감시 예약 함수 (2026-11-01) — 판단은 secretary_watch.js */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const { watchDecision } = require('./secretary_watch');

exports.secretaryWatch = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Seoul', region: 'asia-northeast3', memory: '256MiB' }, async () => {
  const root = admin.database().ref('secretary');
  const [runner, watch] = await Promise.all([root.child('runner').once('value'), root.child('watch').once('value')]);
  const now = Date.now();
  const d = watchDecision(runner.val(), watch.val(), now);
  const updates = { watch: { state: d.state, at: now } };
  if (d.note) updates['notes/' + root.child('notes').push().key] = { msg: d.note, at: now };
  await root.update(updates);
});
