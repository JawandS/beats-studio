import { openDB } from 'idb';

const DB_NAME = 'beatstudio';
const DB_VERSION = 2;
const STORE = 'stems';

type StemRecord = {
  id: string;
  displayName: string;
  createdAt: number;
  zip: ArrayBuffer;
};

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    },
  });
}

export async function saveStemsZip(id: string, displayName: string, buffer: ArrayBuffer) {
  const db = await getDb();
  const record: StemRecord = { id, displayName, createdAt: Date.now(), zip: buffer };
  await db.put(STORE, record);
}

export async function loadStemsZip(id: string) {
  const db = await getDb();
  const data = (await db.get(STORE, id)) as StemRecord | undefined;
  return data;
}

export async function listStems() {
  const db = await getDb();
  return db.getAllFromIndex(STORE, 'createdAt');
}

export async function clearStemsZip(id: string) {
  const db = await getDb();
  await db.delete(STORE, id);
}
