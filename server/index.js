import express from 'express';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, col, clean } from './db.js';
import { registerPlanner } from './planner.js';
import { registerContent } from './content.js';
import {
  cloudEnabled,
  cloudInfo,
  listTemplates,
  uploadMedia,
  sendTemplate,
  sendText,
  sendImage,
  renderTemplate,
  verifyWebhookSignature,
  parseWebhook,
} from './cloud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env -> use real environment variables
}

const PORT = process.env.PORT || 5000;
const HISTORY_LIMIT = 100;
const SENDER = 'cloud'; // jobs are tagged with this; all messages go through the official Meta Cloud API
const DEFAULT_COUNTRY_CODE = '91';
const MAX_PER_BATCH = 250;
const DEFAULT_DAILY_LIMIT = 250; // Meta's starting tier: 250 unique customers / 24h

// ---------------- Settings ----------------
const settings = { limits: { [SENDER]: DEFAULT_DAILY_LIMIT } };
async function loadSettings() {
  const doc = await col.settings().findOne({ _id: 'app' });
  if (doc?.limits?.[SENDER] !== undefined) settings.limits[SENDER] = doc.limits[SENDER];
}
const saveSettings = () =>
  col.settings().updateOne({ _id: 'app' }, { $set: { [`limits.${SENDER}`]: settings.limits[SENDER] } }, { upsert: true });

// ---------------- Opt-out (Do Not Disturb) ----------------
// "STOP", "unsubscribe", "band karo", "mat bhejo", Meta's "Stop promotions" button ... as the whole reply
const STOP_RE =
  /^\s*(stop|stop all|stop promotions|unsubscribe|cancel|remove|band karo|band kro|mat bhejo|message mat bhejo|no more)\s*[.!]*\s*$/i;

async function addOptOut(number, source, note = '') {
  await col
    .optouts()
    .updateOne(
      { _id: number },
      { $setOnInsert: { _id: number, number, source, note, createdAt: new Date().toISOString() } },
      { upsert: true }
    );
}

async function optedOut(numbers) {
  const docs = await col.optouts().find({ _id: { $in: numbers } }, { projection: { _id: 1 } }).toArray();
  return new Set(docs.map((d) => d._id));
}

// ---------------- Inbox ----------------
// "yes", "haan", "interested" ... at the start of a reply -> highlighted as a lead
const YES_RE = /^\s*(yes|yess+|yeah|yup|haan|han|ha|haa|ji haan|ji|interested|ok|okay|sure|call me)\b/i;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000; // free-form replies are allowed for 24h after the customer writes
// delivery receipts only move forward: sent -> delivered -> read
const LATER_STATUSES = { sent: ['delivered', 'read'], delivered: ['read'], read: [], failed: [] };

async function saveMessage(msg) {
  const doc = { read: msg.direction === 'out', ...msg };
  if (msg._id) await col.messages().updateOne({ _id: msg._id }, { $setOnInsert: doc }, { upsert: true });
  else await col.messages().insertOne({ _id: `${msg.direction}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, ...doc });
}

async function handleIncoming(m) {
  if (!m.from) return;
  const text = String(m.text || '').trim();
  const stop = STOP_RE.test(text);
  await saveMessage({
    _id: m.id,
    number: m.from,
    name: m.name || '',
    direction: 'in',
    type: m.type,
    text: text || `[${m.type || 'message'}]`,
    interested: !stop && YES_RE.test(text),
    stop,
    time: m.time,
  });
  if (stop) {
    await addOptOut(m.from, 'official API', text.slice(0, 50));
    console.log(`[opt-out] +${m.from} replied "${text}"`);
  }
}

// ---------------- Daily usage ----------------
// day boundary in India time
function startOfTodayIST() {
  const offset = 330 * 60 * 1000;
  const d = new Date(Date.now() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - offset).toISOString();
}

let currentJob = null;
const jobRunning = () => currentJob && !currentJob.done;

async function usedToday() {
  const [row] = await col
    .jobs()
    .aggregate([
      { $match: { accountId: SENDER, kind: { $ne: 'custom' }, createdAt: { $gte: startOfTodayIST() } } },
      { $unwind: '$results' },
      { $match: { 'results.status': 'sent' } },
      { $count: 'n' },
    ])
    .toArray();
  // the running job is only written to the DB when it finishes
  const live =
    jobRunning() && currentJob.kind !== 'custom' ? currentJob.results.filter((r) => r.status === 'sent').length : 0;
  return (row?.n || 0) + live;
}

// ---------------- Images (template header posters) ----------------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' }; // what WhatsApp accepts for image headers

// "data:image/png;base64,...." -> image stored in MongoDB, returns its name
async function saveImage(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !IMAGE_TYPES[m[1]]) throw new Error('Sirf JPG ya PNG image chalegi.');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > 5 * 1024 * 1024) throw new Error('Image 5MB se chhoti honi chahiye (WhatsApp ki limit).');
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
  await col.images().insertOne({ _id: name, contentType: m[1], data, createdAt: new Date() });
  return name;
}

const getImage = (name) => col.images().findOne({ _id: String(name) });
const imageExists = async (name) => !!name && (await col.images().countDocuments({ _id: String(name) }, { limit: 1 })) > 0;

// ---------------- Helpers ----------------
function normalizeNumber(raw) {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finishJob(job) {
  job.done = true;
  job.finishedAt = new Date().toISOString();
  await col
    .jobs()
    .replaceOne({ _id: job.id }, { _id: job.id, ...job }, { upsert: true })
    .catch((e) => console.error('History save failed:', e.message));
}

// number -> when its 24h customer-service window closes, for numbers that wrote to us in the last 24h
async function openWindows(numbers) {
  const since = new Date(Date.now() - REPLY_WINDOW_MS).toISOString();
  const match = { direction: 'in', time: { $gt: since }, ...(numbers && { number: { $in: numbers } }) };
  const rows = await col
    .messages()
    .aggregate([{ $match: match }, { $group: { _id: '$number', lastIn: { $max: '$time' } } }])
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, new Date(new Date(r.lastIn).getTime() + REPLY_WINDOW_MS).toISOString()]));
}

// free-form text / image to people whose 24h window is open
async function runCustomJob(job) {
  let mediaId = null;
  try {
    if (job.image) {
      const img = await getImage(job.image);
      mediaId = await uploadMedia(Buffer.from(img.data.buffer), img.contentType, img._id);
    }
  } catch (e) {
    for (const item of job.results)
      if (item.status === 'pending') Object.assign(item, { status: 'failed', error: `Image upload: ${e.message}` });
    return finishJob(job);
  }

  for (const item of job.results) {
    if (item.status === 'skipped') continue;
    item.status = 'sending';
    try {
      item.wamid = mediaId ? await sendImage(item.number, mediaId, job.message) : await sendText(item.number, job.message);
      item.status = 'sent';
      item.delivery = 'sent';
      await saveMessage({
        _id: item.wamid,
        number: item.number,
        direction: 'out',
        type: mediaId ? 'image' : 'text',
        text: job.message || '[image]',
        image: job.image,
        delivery: 'sent',
        time: new Date().toISOString(),
      }).catch(() => {});
    } catch (err) {
      item.status = 'failed';
      item.error = err.message || 'Failed';
    }
    item.time = new Date().toISOString();
    if (item !== job.results.at(-1)) await sleep(300);
  }
  await finishJob(job);
}

// Meta queues and paces delivery itself, a short gap is enough
async function runJob(job, tpl) {
  let headerImageId = null;
  try {
    if (tpl.headerFormat === 'IMAGE') {
      const img = await getImage(job.image);
      headerImageId = await uploadMedia(Buffer.from(img.data.buffer), img.contentType, img._id);
    }
  } catch (e) {
    for (const item of job.results)
      if (item.status === 'pending') Object.assign(item, { status: 'failed', error: `Image upload: ${e.message}` });
    return finishJob(job);
  }

  for (const item of job.results) {
    if (item.status === 'skipped') continue;
    item.status = 'sending';
    try {
      item.wamid = await sendTemplate(item.number, tpl, { params: job.params, headerImageId });
      item.status = 'sent';
      item.delivery = 'sent';
      await saveMessage({
        _id: item.wamid,
        number: item.number,
        direction: 'out',
        type: 'template',
        template: tpl.name,
        text: job.message,
        image: job.image,
        delivery: 'sent',
        time: new Date().toISOString(),
      }).catch(() => {});
    } catch (err) {
      item.status = 'failed';
      item.error = err.message || 'Failed';
    }
    item.time = new Date().toISOString();
    if (item !== job.results.at(-1)) await sleep(300);
  }
  await finishJob(job);
}

// ---------------- API ----------------
const app = express();
app.use(cors());
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      if (req.url.startsWith('/api/webhook')) req.rawBody = buf;
    },
  })
);

// async route errors -> JSON 500 instead of crashing
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.userMessage || 'Server/database error. Thodi der baad try karein.' });
  });

// ---------------- Admin login ----------------
// The password changed from the UI is stored (scrypt-hashed) in MongoDB; until then
// ADMIN_PASSWORD from .env is used. With neither set (local dev) the panel is open.
// Cookies are signed with a key derived from the current password, so changing it logs out other devices.
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const auth = { hash: null, envPassword: process.env.ADMIN_PASSWORD || '' };
const authEnabled = () => !!(auth.hash || auth.envPassword);
let sessionKey;
const refreshSessionKey = () => {
  sessionKey = crypto.createHash('sha256').update(`wa-sender:${auth.hash || auth.envPassword}`).digest();
};
refreshSessionKey();

const signSession = (exp) => crypto.createHmac('sha256', sessionKey).update(String(exp)).digest('hex');
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;

function checkPassword(password) {
  if (auth.hash) return safeEqual(hashPassword(password, auth.hash.split(':')[0]), auth.hash);
  return !!auth.envPassword && safeEqual(password, auth.envPassword);
}

async function loadAuth() {
  const doc = await col.settings().findOne({ _id: 'auth' });
  if (doc?.hash) auth.hash = doc.hash;
  refreshSessionKey();
}

function isLoggedIn(req) {
  if (!authEnabled()) return true;
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('wa_session='));
  const [exp, sig] = (cookie?.slice('wa_session='.length) || '').split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEqual(sig, signSession(exp));
}

function setSessionCookie(req, res) {
  const exp = Date.now() + SESSION_MS;
  res.cookie('wa_session', `${exp}.${signSession(exp)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MS,
  });
}

app.set('trust proxy', 1);

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    if (!authEnabled() || !checkPassword(req.body?.password || '')) {
      await sleep(1000); // slow down password guessing
      return res.status(401).json({ error: 'Password galat hai.' });
    }
    setSessionCookie(req, res);
    res.json({ ok: true });
  })
);

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('wa_session');
  res.json({ ok: true });
});

// ---- Meta Cloud API webhook (public: Meta calls it, verified by token/signature) ----
app.get('/api/webhook', (req, res) => {
  const token = process.env.WA_WEBHOOK_VERIFY_TOKEN;
  if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token)
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  res.sendStatus(403);
});

app.post(
  '/api/webhook',
  wrap(async (req, res) => {
    if (!verifyWebhookSignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200); // answer fast, Meta retries slow webhooks
    const { incoming, statuses } = parseWebhook(req.body);
    for (const m of incoming) await handleIncoming(m);
    for (const st of statuses) {
      // Meta can deliver receipts out of order — never move read back to delivered/sent
      const later = LATER_STATUSES[st.status] || [];
      await col
        .messages()
        .updateOne(
          { _id: st.id, delivery: { $nin: later } },
          { $set: { delivery: st.status, ...(st.error && { error: st.error }) } }
        );
      const live = currentJob?.results.find((r) => r.wamid === st.id);
      if (live && !later.includes(live.delivery)) Object.assign(live, { delivery: st.status }, st.error && { error: st.error });
      await col
        .jobs()
        .updateOne(
          { results: { $elemMatch: { wamid: st.id, delivery: { $nin: later } } } },
          { $set: { 'results.$.delivery': st.status, ...(st.error && { 'results.$.error': st.error }) } }
        );
    }
  })
);

// everything else under /api needs a login
app.use('/api', (req, res, next) => {
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: 'Login karein.', needLogin: true });
});

// change the admin password from the UI (needs a login, and the current password)
app.post(
  '/api/auth/change-password',
  wrap(async (req, res) => {
    const { current = '', next = '' } = req.body || {};
    if (authEnabled() && !checkPassword(current)) {
      await sleep(1000);
      return res.status(400).json({ error: 'Purana password galat hai.' });
    }
    if (String(next).length < 8) return res.status(400).json({ error: 'Naya password kam se kam 8 characters ka ho.' });
    if (String(next).length > 128) return res.status(400).json({ error: 'Password bahut lamba hai.' });

    const hash = hashPassword(next);
    await col.settings().updateOne({ _id: 'auth' }, { $set: { hash, updatedAt: new Date() } }, { upsert: true });
    auth.hash = hash;
    refreshSessionKey(); // other devices are logged out
    setSessionCookie(req, res); // this browser stays logged in
    res.json({ ok: true });
  })
);

// the WhatsApp number messages go out from
async function senderStatus() {
  if (!cloudEnabled()) return { status: 'not-configured' };
  const info = await cloudInfo();
  return info.ok
    ? { status: 'connected', phone: info.phone, name: info.name, quality: info.quality, tier: info.tier }
    : { status: 'error', error: info.error };
}

app.get(
  '/api/status',
  wrap(async (req, res) => {
    res.json({
      sender: await senderStatus(),
      job: currentJob,
      authEnabled: authEnabled(),
      limit: settings.limits[SENDER],
      usedToday: await usedToday(),
      maxPerBatch: MAX_PER_BATCH,
      unread: await col.messages().countDocuments({ direction: 'in', read: false }),
    });
  })
);

app.post(
  '/api/send',
  wrap(async (req, res) => {
    const { numbers, image, cloudTemplate, params = [], mode, message = '' } = req.body || {};
    if (jobRunning()) return res.status(409).json({ error: 'Pichle messages abhi bhej rahe hain, thoda wait karein.' });
    if (!cloudEnabled()) return res.status(400).json({ error: 'Official API .env me set nahi hai.' });

    if (mode === 'custom') {
      const text = String(message).trim();
      if (!text && !image) return res.status(400).json({ error: 'Message likhein ya image lagayein.' });
      if (text.length > (image ? 1024 : 4096))
        return res.status(400).json({ error: `Message bahut lamba hai (max ${image ? 1024 : 4096} characters).` });
      if (image && !(await imageExists(image))) return res.status(400).json({ error: 'Image nahi mili, dobara upload karein.' });
      if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Numbers list chahiye.' });
      const unique = [...new Set(numbers.map(normalizeNumber).filter(Boolean))];
      if (!unique.length) return res.status(400).json({ error: 'Kam se kam 1 number dalein.' });
      if (unique.length > MAX_PER_BATCH) return res.status(400).json({ error: `Ek baar me maximum ${MAX_PER_BATCH} numbers.` });

      const blocked = await optedOut(unique);
      const windows = await openWindows(unique);
      const results = unique.map((number) =>
        blocked.has(number)
          ? { number, status: 'skipped', error: 'Opt-out (STOP)' }
          : !windows[number]
            ? { number, status: 'skipped', error: '24 ghante ki window band — template chahiye' }
            : { number, status: 'pending' }
      );
      if (!results.some((r) => r.status === 'pending'))
        return res.status(400).json({
          error: 'In me se kisi ne bhi pichhle 24 ghante me message nahi kiya. Custom message sirf unhe ja sakta hai — baaki ke liye approved template chahiye.',
        });

      const info = await cloudInfo();
      currentJob = {
        id: Date.now().toString(),
        accountId: SENDER,
        kind: 'custom',
        from: info?.phone,
        via: 'official API',
        message: text,
        template: null,
        image: image || null,
        createdAt: new Date().toISOString(),
        done: false,
        results,
      };
      runCustomJob(currentJob).catch((e) => console.error('Job failed:', e));
      return res.json({ job: currentJob });
    }

    const templates = await listTemplates().catch((e) => {
      throw Object.assign(e, { userMessage: `Meta API: ${e.message}` });
    });
    const tpl = templates.find((t) => t.name === cloudTemplate?.name && t.language === cloudTemplate?.language);
    if (!tpl) return res.status(400).json({ error: 'Approved template chunein.' });
    if (Array.from({ length: tpl.vars }, (_, i) => params[i]).some((p) => !String(p ?? '').trim()))
      return res.status(400).json({ error: 'Template ke saare {{ }} khaane bharein.' });
    if (tpl.headerFormat === 'IMAGE' && !(await imageExists(image)))
      return res.status(400).json({ error: 'Is template ke liye image/poster lagayein.' });
    if (tpl.headerFormat && !['TEXT', 'IMAGE'].includes(tpl.headerFormat))
      return res.status(400).json({ error: `${tpl.headerFormat} header wale templates abhi support nahi hain.` });
    if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Numbers list chahiye.' });

    const unique = [...new Set(numbers.map(normalizeNumber).filter(Boolean))];
    if (unique.length === 0) return res.status(400).json({ error: 'Kam se kam 1 number dalein.' });
    if (unique.length > MAX_PER_BATCH) return res.status(400).json({ error: `Ek baar me maximum ${MAX_PER_BATCH} numbers.` });
    const invalid = unique.filter((n) => n.length < 11 || n.length > 15);
    if (invalid.length) return res.status(400).json({ error: `Galat number: ${invalid.join(', ')}` });

    const blocked = await optedOut(unique);
    const toSend = unique.filter((n) => !blocked.has(n));
    if (!toSend.length) return res.status(400).json({ error: 'Saare numbers Opt-out (STOP) list me hain.' });

    const limit = Number(settings.limits[SENDER]) || 0;
    const used = await usedToday();
    const left = Math.max(0, limit - used);
    if (toSend.length > left)
      return res.status(400).json({
        error: left
          ? `Aaj ki limit ${limit} hai, ${used} bhej chuke hain. Abhi sirf ${left} aur bhej sakte hain.`
          : `Aaj ki limit (${limit}) poori ho gayi. Kal bhejein ya Limits me badlein.`,
      });

    const info = await cloudInfo();
    currentJob = {
      id: Date.now().toString(),
      accountId: SENDER,
      from: info?.phone,
      via: 'official API',
      message: renderTemplate(tpl, params),
      template: { name: tpl.name, language: tpl.language },
      params: params.slice(0, tpl.vars),
      image: tpl.headerFormat === 'IMAGE' ? image : null,
      createdAt: new Date().toISOString(),
      done: false,
      results: unique.map((number) =>
        blocked.has(number) ? { number, status: 'skipped', error: 'Opt-out (STOP)' } : { number, status: 'pending' }
      ),
    };
    runJob(currentJob, tpl).catch((e) => console.error('Job failed:', e));
    res.json({ job: currentJob });
  })
);

// ---- inbox ----
// numbers that can receive a custom message right now (wrote to us in the last 24h)
app.get(
  '/api/windows',
  wrap(async (req, res) => res.json(await openWindows()))
);

app.get(
  '/api/inbox',
  wrap(async (req, res) => {
    // conversations that have at least one reply from the customer, newest first
    const list = await col
      .messages()
      .aggregate([
        { $sort: { time: 1 } },
        {
          $group: {
            _id: '$number',
            name: { $max: '$name' },
            last: { $last: '$$ROOT' },
            lastIn: { $max: { $cond: [{ $eq: ['$direction', 'in'] }, '$time', null] } },
            unread: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'in'] }, { $eq: ['$read', false] }] }, 1, 0] } },
            interested: { $max: { $cond: ['$interested', 1, 0] } },
            stop: { $max: { $cond: ['$stop', 1, 0] } },
          },
        },
        { $match: { lastIn: { $ne: null } } },
        { $sort: { 'last.time': -1 } },
        { $limit: 500 },
      ])
      .toArray();
    res.json(
      list.map((c) => ({
        number: c._id,
        name: c.name,
        lastText: c.last.text,
        lastDirection: c.last.direction,
        lastTime: c.last.time,
        lastIn: c.lastIn,
        unread: c.unread,
        interested: !!c.interested,
        stop: !!c.stop,
      }))
    );
  })
);

// delivery status of everyone we messaged: last message per number + whether they replied after it
app.get(
  '/api/sent-status',
  wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const [sent, replies] = await Promise.all([
      col
        .messages()
        .aggregate([
          { $match: { direction: 'out', time: { $gte: since } } },
          { $sort: { time: 1 } },
          { $group: { _id: '$number', last: { $last: '$$ROOT' }, count: { $sum: 1 } } },
          { $sort: { 'last.time': -1 } },
          { $limit: 5000 },
        ])
        .toArray(),
      col
        .messages()
        .aggregate([
          { $match: { direction: 'in', time: { $gte: since } } },
          { $group: { _id: '$number', lastIn: { $max: '$time' }, name: { $max: '$name' } } },
        ])
        .toArray(),
    ]);
    const inMap = Object.fromEntries(replies.map((r) => [r._id, r]));
    const rows = sent.map(({ _id: number, last, count }) => {
      const reply = inMap[number];
      return {
        number,
        name: reply?.name || '',
        text: last.text,
        template: last.template || null,
        time: last.time,
        status: last.delivery || 'sent', // sent | delivered | read | failed
        error: last.error || null,
        count,
        replied: !!reply && reply.lastIn > last.time,
      };
    });
    const counts = { total: rows.length, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 };
    for (const r of rows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.replied) counts.replied++;
    }
    res.json({ days, counts, rows });
  })
);

app.get(
  '/api/inbox/:number',
  wrap(async (req, res) => {
    const number = normalizeNumber(req.params.number);
    const msgs = await col.messages().find({ number }).sort({ time: 1 }).limit(500).toArray();
    await col.messages().updateMany({ number, direction: 'in', read: false }, { $set: { read: true } });
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in')?.time;
    res.json({
      number,
      name: msgs.find((m) => m.name)?.name || '',
      canReply: !!lastIn && Date.now() - new Date(lastIn).getTime() < REPLY_WINDOW_MS,
      windowEndsAt: lastIn ? new Date(new Date(lastIn).getTime() + REPLY_WINDOW_MS).toISOString() : null,
      optedOut: (await optedOut([number])).size > 0,
      messages: msgs.map(({ _id, ...m }) => ({ id: _id, ...m })),
    });
  })
);

app.post(
  '/api/inbox/:number/reply',
  wrap(async (req, res) => {
    const number = normalizeNumber(req.params.number);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Message likhein.' });
    if (text.length > 4096) return res.status(400).json({ error: 'Message bahut lamba hai (max 4096).' });
    const lastIn = await col.messages().find({ number, direction: 'in' }).sort({ time: -1 }).limit(1).next();
    if (!lastIn)
      return res.status(400).json({ error: 'Is number ne abhi tak koi reply nahi kiya. Pehle approved template bhejein.' });
    if (Date.now() - new Date(lastIn.time).getTime() >= REPLY_WINDOW_MS)
      return res.status(400).json({
        error: 'Customer ke aakhri message ko 24 ghante se zyada ho gaye. Ab sirf approved template bhej sakte hain.',
      });
    let wamid;
    try {
      wamid = await sendText(number, text);
    } catch (e) {
      return res.status(502).json({ error: `Meta API: ${e.message}` });
    }
    await saveMessage({ _id: wamid, number, direction: 'out', type: 'text', text, delivery: 'sent', time: new Date().toISOString() });
    res.json({ ok: true });
  })
);

// ---- weekly marketing planner ----
registerPlanner(app, col, wrap);
registerContent(app, col, wrap);

// ---- approved templates from Meta ----
app.get(
  '/api/cloud/templates',
  wrap(async (req, res) => {
    if (!cloudEnabled()) return res.json([]);
    try {
      res.json(await listTemplates());
    } catch (e) {
      res.status(502).json({ error: `Meta API: ${e.message}` });
    }
  })
);

// ---- daily limit ----
app.put(
  '/api/settings/limits',
  wrap(async (req, res) => {
    const n = Math.floor(Number(req.body?.[SENDER]));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return res.status(400).json({ error: 'Limit 0 se 100000 ke beech ho.' });
    settings.limits[SENDER] = n;
    await saveSettings();
    res.json(settings.limits);
  })
);

// ---- opt-out list ----
app.get(
  '/api/optouts',
  wrap(async (req, res) => {
    const list = await col.optouts().find().sort({ createdAt: -1 }).toArray();
    res.json(list.map(clean));
  })
);

app.post(
  '/api/optouts',
  wrap(async (req, res) => {
    const nums = [...new Set((req.body?.numbers || []).map(normalizeNumber))].filter((n) => n.length >= 11 && n.length <= 15);
    if (!nums.length) return res.status(400).json({ error: 'Sahi number dalein.' });
    for (const n of nums) await addOptOut(n, 'manual', String(req.body?.note || '').slice(0, 100));
    res.json({ ok: true, added: nums.length });
  })
);

app.delete(
  '/api/optouts/:number',
  wrap(async (req, res) => {
    await col.optouts().deleteOne({ _id: normalizeNumber(req.params.number) });
    res.json({ ok: true });
  })
);

app.get(
  '/api/history',
  wrap(async (req, res) => {
    const list = await col.jobs().find().sort({ createdAt: -1 }).limit(HISTORY_LIMIT).toArray();
    res.json(list.map(clean));
  })
);

// upload a template header image once, then use its name in /api/send
app.post(
  '/api/uploads',
  wrap(async (req, res) => {
    try {
      res.json({ image: await saveImage(req.body?.data) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

app.get(
  '/api/uploads/:name',
  wrap(async (req, res) => {
    const img = await getImage(req.params.name);
    if (!img) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(img.contentType).send(Buffer.from(img.data.buffer));
  })
);

// serve built React app (npm start)
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------------- Start ----------------
try {
  await connectDB();
  await loadSettings();
  await loadAuth();
} catch (err) {
  console.error('MongoDB connect nahi hua:', err.message);
  process.exit(1);
}

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

if (cloudEnabled())
  cloudInfo(true).then((i) => console.log(i.ok ? `Official API ready: +${i.phone} (${i.name})` : `Official API error: ${i.error}`));
else console.log('Official API .env me set nahi hai (WA_CLOUD_TOKEN, WA_PHONE_NUMBER_ID, WA_BUSINESS_ACCOUNT_ID).');
