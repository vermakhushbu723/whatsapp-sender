import dns from 'dns';
import { MongoClient } from 'mongodb';

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
    col.jobs().createIndex({ 'results.wamid': 1 }, { sparse: true }),
    col.messages().createIndex({ number: 1, time: 1 }),
    col.messages().createIndex({ direction: 1, read: 1 }),
  ]);
  console.log(`MongoDB connected (db: ${db.databaseName})`);
  return db;
}

export const col = {
  settings: () => db.collection('settings'),
  jobs: () => db.collection('history'),
  images: () => db.collection('images'), // template header posters
  optouts: () => db.collection('optouts'), // numbers that replied STOP / were blocked manually
  messages: () => db.collection('messages'), // inbox: replies from customers + what we sent them
};

// strip mongo _id from documents sent to the client
export const clean = ({ _id, ...doc }) => doc;
