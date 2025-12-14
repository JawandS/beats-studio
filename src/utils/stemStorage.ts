import { openDB } from 'idb';

const DB_NAME = 'beatstudio';
const DB_VERSION = 1;
const STORE = 'stems';
const KEY = 'latest';

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
}

export async function saveStemsZip(buffer: ArrayBuffer) {
  const db = await getDb();
  await db.put(STORE, buffer, KEY);
}

export async function loadStemsZip() {
  const db = await getDb();
  const data = await db.get(STORE, KEY);
  return data as ArrayBuffer | undefined;
}

export async function clearStemsZip() {
  const db = await getDb();
  await db.delete(STORE, KEY);
}
