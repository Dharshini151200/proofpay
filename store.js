// Tiny document store: Postgres (JSONB) when DATABASE_URL is set, a JSON file otherwise.
// Collections: workspaces, tests, attempts.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));

function jsonStore(file) {
  let db = {};
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = (col) => (db[col] ||= []);
  const persist = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); };
  return {
    async init() {},
    async get(col, field, value) { return clone(c(col).find((d) => d[field] === value)); },
    async list(col, field, value) { return clone(c(col).filter((d) => d[field] === value)); },
    async all(col) { return clone(c(col)); },
    async save(col, doc) {
      const arr = c(col); const i = arr.findIndex((d) => d.id === doc.id);
      if (i >= 0) arr[i] = clone(doc); else arr.push(clone(doc));
      persist(); return doc;
    },
    async remove(col, field, value) { db[col] = c(col).filter((d) => d[field] !== value); persist(); },
  };
}

function pgStore(url) {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (col, id));
        CREATE INDEX IF NOT EXISTS docs_gin ON docs USING GIN (data jsonb_path_ops);`);
    },
    async get(col, field, value) {
      const r = await pool.query('SELECT data FROM docs WHERE col=$1 AND data @> $2 LIMIT 1', [col, { [field]: value }]);
      return r.rows[0]?.data || null;
    },
    async list(col, field, value) {
      const r = await pool.query('SELECT data FROM docs WHERE col=$1 AND data @> $2', [col, { [field]: value }]);
      return r.rows.map((x) => x.data);
    },
    async all(col) { return (await pool.query('SELECT data FROM docs WHERE col=$1', [col])).rows.map((x) => x.data); },
    async save(col, doc) {
      await pool.query('INSERT INTO docs (col, id, data) VALUES ($1,$2,$3) ON CONFLICT (col, id) DO UPDATE SET data=$3', [col, doc.id, doc]);
      return doc;
    },
    async remove(col, field, value) { await pool.query('DELETE FROM docs WHERE col=$1 AND data @> $2', [col, { [field]: value }]); },
  };
}

export const store = process.env.DATABASE_URL
  ? pgStore(process.env.DATABASE_URL)
  : jsonStore(process.env.DATA_FILE || path.resolve('data/db.json'));
