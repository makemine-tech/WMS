/* QR 출퇴근기록기 서버 함수 */
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const { makeHandlers, clientIp } = require('./public');
const { makeAdmin } = require('./admin');
const { makeTransport } = require('./mail');

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

const REGION = 'asia-northeast3';
const OPTS = { region: REGION, memory: '256MiB' };
const MAIL_OPTS = { region: REGION, memory: '512MiB', timeoutSeconds: 540, secrets: [GMAIL_USER, GMAIL_APP_PASSWORD] };

const db = { ref: (p) => admin.database().ref(p) };
const now = () => Date.now();
const pub = makeHandlers(db, now);
const adm = makeAdmin(db, now, () => {
  const user = GMAIL_USER.value();
  return { transport: makeTransport(user, GMAIL_APP_PASSWORD.value()), from: { name: '메이크마인 출퇴근기록', address: user } };
});
const ipOf = (req) => clientIp(req.rawRequest);

exports.qraInfo = onCall(OPTS, (req) => pub.info(req.data, { ip: ipOf(req) }));
exports.qraPunch = onCall(OPTS, (req) => pub.punch(req.data, { ip: ipOf(req) }));

exports.qraEditLog = onCall(OPTS, (req) => adm.editLog(req.data, req.auth));
exports.qraEditWorker = onCall(OPTS, (req) => adm.editWorker(req.data, req.auth));
exports.qraRotateKey = onCall(OPTS, (req) => adm.rotateKey(req.data, req.auth));
exports.qraExport = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 120 }, (req) => adm.exportLogs(req.data, req.auth));
exports.qraSendNow = onCall(MAIL_OPTS, (req) => adm.sendNow(req.data, req.auth));

/* 매일 7~10시 정각: 발송 대상 처리(실패분 재시도), 7시 회차에 1년 지난 기록 삭제 */
exports.qraMailTick = onSchedule(Object.assign({ schedule: '0 7-10 * * *', timeZone: 'Asia/Seoul' }, MAIL_OPTS), () => adm.runTick());
