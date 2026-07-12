import { Committer } from "../commit.js";
import { openDb } from "../db.js";
const db = openDb(process.env.DB_FILE!);
const d = db.prepare("SELECT id, hash FROM decisions ORDER BY id LIMIT 1").get() as { id: number; hash: string };
const c = new Committer(db);
c.enqueue(d.id, d.hash);
await new Promise((r) => setTimeout(r, 25_000));
console.log(db.prepare("SELECT id, memo_sig FROM decisions WHERE id = ?").get(d.id));
process.exit(0);
