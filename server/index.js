import express from 'express';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import {
  connectDB,
  col,
  clean,
  useMongoAuthState,
  hasSession,
  clearSession,
  importLocalData,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // no .env -> use real environment variables
}

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PORT = process.env.PORT || 5000;
const MAX_NUMBERS = 20;
const HISTORY_LIMIT = 100;
const ACCOUNT_IDS = ['1', '2'];
const DEFAULT_COUNTRY_CODE = '91';

// ---------------- Settings ----------------
const settings = { active: '1' };
async function loadSettings() {
  const doc = await col.settings().findOne({ _id: 'app' });
  if (doc && ACCOUNT_IDS.includes(doc.active)) settings.active = doc.active;
}
const saveSettings = () => col.settings().updateOne({ _id: 'app' }, { $set: settings }, { upsert: true });

// ---------------- WhatsApp accounts ----------------
// status: idle (not logged in) | connecting | qr | connected | disconnected
const accounts = Object.fromEntries(
  ACCOUNT_IDS.map((id) => [id, { id, sock: null, status: 'idle', qr: null, me: null }])
);

async function connectAccount(id) {
  const acc = accounts[id];
  if (['connecting', 'qr', 'connected'].includes(acc.status)) return;
  acc.status = 'connecting';
  acc.qr = null;

  try {
    const { state, saveCreds } = await useMongoAuthState(id);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
    });
    acc.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (acc.sock !== sock) return; // event from an old socket
      if (qr) {
        acc.status = 'qr';
        acc.qr = await QRCode.toDataURL(qr, { width: 300, margin: 1 });
      }
      if (connection === 'open') {
        acc.status = 'connected';
        acc.qr = null;
        acc.me = { id: sock.user?.id?.split(':')[0].split('@')[0], name: sock.user?.name || '' };
        console.log(`[account ${id}] connected as +${acc.me.id}`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        acc.sock = null;
        acc.qr = null;
        if (code === DisconnectReason.loggedOut) {
          console.log(`[account ${id}] logged out, session cleared`);
          await clearSession(id);
          acc.status = 'idle';
          acc.me = null;
        } else if (state.creds.registered) {
          // logged-in account dropped (network etc.) -> reconnect
          acc.status = 'disconnected';
          setTimeout(() => connectAccount(id), 2000);
        } else {
          // QR expired without scan -> wait for user to click login again
          acc.status = 'idle';
        }
      }
    });
  } catch (err) {
    console.error(`[account ${id}] connect failed:`, err.message);
    acc.status = 'disconnected';
    setTimeout(() => connectAccount(id), 5000);
  }
}

async function logoutAccount(id) {
  const acc = accounts[id];
  const sock = acc.sock;
  acc.sock = null;
  try {
    if (acc.status === 'connected') await sock?.logout();
    else sock?.end();
  } catch {
    sock?.end();
  }
  await clearSession(id);
  Object.assign(acc, { status: 'idle', qr: null, me: null });
}

const publicAccount = ({ id, status, qr, me }) => ({ id, status, qr, me });

// ---------------- Images ----------------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// "data:image/png;base64,...." -> image stored in MongoDB, returns its name
async function saveImage(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !IMAGE_TYPES[m[1]]) throw new Error('Sirf JPG, PNG, WEBP ya GIF image chalegi.');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > 15 * 1024 * 1024) throw new Error('Image 15MB se chhoti honi chahiye.');
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
let currentJob = null;

async function runJob(job, acc) {
  const img = job.image ? await getImage(job.image) : null;
  for (const item of job.results) {
    if (acc.status !== 'connected') {
      item.status = 'failed';
      item.error = 'WhatsApp disconnected';
      continue;
    }
    item.status = 'sending';
    try {
      const [check] = await acc.sock.onWhatsApp(`${item.number}@s.whatsapp.net`);
      if (!check?.exists) throw new Error('Number is not on WhatsApp');
      const content = img ? { image: Buffer.from(img.data.buffer), caption: job.message } : { text: job.message };
      await acc.sock.sendMessage(check.jid, content);
      item.status = 'sent';
    } catch (err) {
      item.status = 'failed';
      item.error = err.message || 'Failed';
    }
    item.time = new Date().toISOString();
    // random gap between messages so the account doesn't look like a bot
    if (item !== job.results.at(-1)) await sleep(3000 + Math.random() * 3000);
  }
  job.done = true;
  job.finishedAt = new Date().toISOString();
  await col
    .jobs()
    .replaceOne({ _id: job.id }, { _id: job.id, ...job }, { upsert: true })
    .catch((e) => console.error('History save failed:', e.message));
}

// ---------------- API ----------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// async route errors -> JSON 500 instead of crashing
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Server/database error. Thodi der baad try karein.' });
  });

const jobRunning = () => currentJob && !currentJob.done;

app.get('/api/status', (req, res) => {
  res.json({
    accounts: ACCOUNT_IDS.map((id) => publicAccount(accounts[id])),
    active: settings.active,
    job: currentJob,
  });
});

app.param('id', (req, res, next, id) => {
  if (!accounts[id]) return res.status(404).json({ error: 'Account nahi mila.' });
  next();
});

// make this account the one messages are sent from
app.post(
  '/api/accounts/:id/select',
  wrap(async (req, res) => {
    if (jobRunning())
      return res.status(409).json({ error: 'Messages bhej rahe hain, khatam hone ke baad switch karein.' });
    settings.active = req.params.id;
    await saveSettings();
    res.json({ ok: true });
  })
);

// start login -> QR code appears in /api/status
app.post(
  '/api/accounts/:id/login',
  wrap(async (req, res) => {
    await connectAccount(req.params.id);
    res.json({ ok: true });
  })
);

app.post(
  '/api/accounts/:id/logout',
  wrap(async (req, res) => {
    if (jobRunning() && currentJob.accountId === req.params.id)
      return res.status(409).json({ error: 'Is account se messages ja rahe hain, thoda wait karein.' });
    await logoutAccount(req.params.id);
    res.json({ ok: true });
  })
);

app.post(
  '/api/send',
  wrap(async (req, res) => {
    const { numbers, message = '', image } = req.body || {};
    const acc = accounts[settings.active];
    if (acc.status !== 'connected')
      return res.status(400).json({ error: `Account ${acc.id} connected nahi hai. Pehle QR scan karein.` });
    if (jobRunning()) return res.status(409).json({ error: 'Pichle messages abhi bhej rahe hain, thoda wait karein.' });
    if (image && !(await imageExists(image)))
      return res.status(400).json({ error: 'Image nahi mili, dobara upload karein.' });
    if (!message.trim() && !image) return res.status(400).json({ error: 'Message ya image me se kuch to dalein.' });
    if (!Array.isArray(numbers)) return res.status(400).json({ error: 'Numbers list chahiye.' });

    const unique = [...new Set(numbers.map(normalizeNumber).filter(Boolean))];
    if (unique.length === 0) return res.status(400).json({ error: 'Kam se kam 1 number dalein.' });
    if (unique.length > MAX_NUMBERS) return res.status(400).json({ error: `Maximum ${MAX_NUMBERS} numbers allowed.` });
    const invalid = unique.filter((n) => n.length < 11 || n.length > 15);
    if (invalid.length) return res.status(400).json({ error: `Galat number: ${invalid.join(', ')}` });

    currentJob = {
      id: Date.now().toString(),
      accountId: acc.id,
      from: acc.me?.id,
      message: message.trim(),
      image: image || null,
      createdAt: new Date().toISOString(),
      done: false,
      results: unique.map((number) => ({ number, status: 'pending' })),
    };
    runJob(currentJob, acc).catch((e) => console.error('Job failed:', e));
    res.json({ job: currentJob });
  })
);

app.get(
  '/api/history',
  wrap(async (req, res) => {
    const list = await col.jobs().find().sort({ createdAt: -1 }).limit(HISTORY_LIMIT).toArray();
    res.json(list.map(clean));
  })
);

// upload an image once, then use its name in /api/send or a template
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

// ---- saved messages (templates) ----
app.get(
  '/api/templates',
  wrap(async (req, res) => {
    const list = await col.templates().find().sort({ createdAt: 1 }).toArray();
    res.json(list.map(clean));
  })
);

async function templateFromBody(body) {
  const name = String(body?.name || '').trim();
  const text = String(body?.text || '').trim();
  const image = body?.image || null;
  if (!name) throw new Error('Template ka naam dalein.');
  if (!text && !image) throw new Error('Message ya image me se kuch to dalein.');
  if (image && !(await imageExists(image))) throw new Error('Image nahi mili, dobara upload karein.');
  return { name, text, image };
}

app.post(
  '/api/templates',
  wrap(async (req, res) => {
    let fields;
    try {
      fields = await templateFromBody(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const t = { id: Date.now().toString(), ...fields, createdAt: new Date().toISOString() };
    await col.templates().insertOne({ _id: t.id, ...t });
    res.json(t);
  })
);

app.put(
  '/api/templates/:tid',
  wrap(async (req, res) => {
    let fields;
    try {
      fields = await templateFromBody(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const t = await col
      .templates()
      .findOneAndUpdate(
        { _id: req.params.tid },
        { $set: { ...fields, updatedAt: new Date().toISOString() } },
        { returnDocument: 'after' }
      );
    if (!t) return res.status(404).json({ error: 'Template nahi mila.' });
    res.json(clean(t));
  })
);

app.delete(
  '/api/templates/:tid',
  wrap(async (req, res) => {
    await col.templates().deleteOne({ _id: req.params.tid });
    res.json({ ok: true });
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
  await importLocalData(DATA_DIR);
  await loadSettings();
} catch (err) {
  console.error('MongoDB connect nahi hua:', err.message);
  process.exit(1);
}

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// reconnect accounts that already have a saved session; first run -> show QR for the active account
const sessions = await Promise.all(ACCOUNT_IDS.map(hasSession));
ACCOUNT_IDS.forEach((id, i) => sessions[i] && connectAccount(id));
if (!sessions.some(Boolean)) connectAccount(settings.active);
