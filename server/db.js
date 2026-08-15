import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyStore() {
  return { users: [], organizations: [], memberships: [], orgData: {}, passwordResets: [], invites: [], notifications: {} };
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

export function emptyFactoryData() {
  return {
    inventory: { emptyBags: 0, finishedBags: 0 },
    intake: [],
    rolls: [],
    production: [],
    expenses: [],
    salesFactory: [],
    salesMobile: [],
    sellers: [],
  };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function slugify(name) {
  const base = String(name || "org")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "org";
  return `${base}-${uid().slice(0, 6)}`;
}

export const store = {
  read: readStore,
  write: writeStore,
  update(mutator) {
    const s = readStore();
    const result = mutator(s);
    writeStore(s);
    return result;
  },
};

export default store;
