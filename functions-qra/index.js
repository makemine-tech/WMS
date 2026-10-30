/* QR 출퇴근기록기 서버 함수 */
const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const { makeHandlers } = require('./public');

const OPTS = { region: 'asia-northeast3', memory: '256MiB' };
const db = { ref: (p) => admin.database().ref(p) };
const pub = makeHandlers(db, () => Date.now());
const ipOf = (req) => (req.rawRequest && req.rawRequest.ip) || 'unknown';

exports.qraInfo = onCall(OPTS, (req) => pub.info(req.data, { ip: ipOf(req) }));
exports.qraPunch = onCall(OPTS, (req) => pub.punch(req.data, { ip: ipOf(req) }));
