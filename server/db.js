import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

// Windows/Node often can't resolve Atlas SRV records with the system resolver
dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers()]);

let db;

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI .env file me nahi hai.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'whatsapp_sender');
  await Promise.all([
    col.jobs().createIndex({ createdAt: -1 }),
    col.templates().createIndex({ createdAt: 1 }),
    col.auth().createIndex({ account: 1 }),
  ]);
  console.log(`MongoDB connected (db: ${db.databaseName})`);
  return db;
}

export const col = {
  auth: () => db.collection('wa_auth'), // WhatsApp login sessions
  settings: () => db.collection('settings'),
  templates: () => db.collection('templates'),
  jobs: () => db.collection('history'),
  images: () => db.collection('images'),
};

// strip mongo _id from documents sent to the client
export const clean = ({ _id, ...doc }) => doc;

// ---------- Baileys auth state stored in MongoDB (one doc per key) ----------
export async function useMongoAuthState(account) {
  const key = (name) => `${account}:${name}`;
  const write = (name, data) =>
    col.auth().replaceOne(
      { _id: key(name) },
      { _id: key(name), account, value: JSON.stringify(data, BufferJSON.replacer) },
      { upsert: true }
    );
  const read = async (name) => {
    const doc = await col.auth().findOne({ _id: key(name) });
    return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };
  const remove = (name) => col.auth().deleteOne({ _id: key(name) });

  const creds = (await read('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data)
            for (const id in data[type]) {
              const value = data[type][id];
              tasks.push(value ? write(`${type}-${id}`, value) : remove(`${type}-${id}`));
            }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write('creds', creds),
  };
}

export async function hasSession(account) {
  const doc = await col.auth().findOne({ _id: `${account}:creds` });
  return !!doc && JSON.parse(doc.value).registered === true;
}

export const clearSession = (account) => col.auth().deleteMany({ account });

// ---------- one-time import of the old local data/ folder ----------
// copies only into empty collections and never deletes the local files
export async function importLocalData(dataDir) {
  if (!fs.existsSync(dataDir)) return;
  const readJSON = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
    } catch {
      return null;
    }
  };
  const done = [];

  const authRoot = path.join(dataDir, 'auth');
  for (const account of ['1', '2']) {
    const dir = path.join(authRoot, account);
    if (!fs.existsSync(path.join(dir, 'creds.json'))) continue;
    if (await col.auth().findOne({ account })) continue;
    const docs = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        // useMultiFileAuthState writes "/" as "__" in file names (":" -> "-" can't be reversed;
        // those few signal sessions are simply re-created by WhatsApp)
        const name = f.slice(0, -5).replace(/__/g, '/');
        return { _id: `${account}:${name}`, account, value: fs.readFileSync(path.join(dir, f), 'utf8') };
      });
    if (docs.length) await col.auth().insertMany(docs);
    done.push(`account ${account} login`);
  }

  const settings = readJSON('settings.json');
  if (settings && !(await col.settings().findOne({ _id: 'app' }))) {
    await col.settings().insertOne({ _id: 'app', active: settings.active || '1' });
    done.push('settings');
  }

  const templates = readJSON('templates.json');
  if (templates?.length && !(await col.templates().countDocuments())) {
    await col.templates().insertMany(templates.map((t) => ({ _id: t.id, ...t })));
    done.push(`${templates.length} templates`);
  }

  const history = readJSON('history.json');
  if (history?.length && !(await col.jobs().countDocuments())) {
    await col.jobs().insertMany(history.map((j) => ({ _id: j.id, ...j })));
    done.push(`${history.length} history`);
  }

  const uploads = path.join(dataDir, 'uploads');
  if (fs.existsSync(uploads) && !(await col.images().countDocuments())) {
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const files = fs.readdirSync(uploads).filter((f) => types[f.split('.').pop()]);
    for (const f of files)
      await col.images().insertOne({
        _id: f,
        contentType: types[f.split('.').pop()],
        data: fs.readFileSync(path.join(uploads, f)),
        createdAt: new Date(),
      });
    if (files.length) done.push(`${files.length} images`);
  }

  if (done.length) console.log(`Local data/ se MongoDB me copy kiya: ${done.join(', ')}`);
}
