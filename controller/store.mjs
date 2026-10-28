import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const ACTIVE = ['preparing', 'executing', 'verifying', 'validated', 'integrating'];
const now = () => new Date().toISOString();

export class Store {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS directions (
        version INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        direction_version INTEGER NOT NULL REFERENCES directions(version), data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS single_active_run ON runs((1))
        WHERE status IN ('preparing','executing','verifying','validated','integrating');
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id),
        at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  direction() {
    const row = this.db.prepare('SELECT * FROM directions ORDER BY version DESC LIMIT 1').get();
    return row ? { version: row.version, at: row.created_at, ...JSON.parse(row.body) } : null;
  }
  setDirection(body) {
    return this.transaction(() => {
      if (this.db.prepare(`SELECT 1 FROM runs WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).get(...ACTIVE)) {
        throw new Error('active_run: 先等待或结束当前工作，再变更方向。');
      }
      const current = this.direction();
      if (current?.goal === body.goal && JSON.stringify(current.constraints) === JSON.stringify(body.constraints)) return current;
      this.db.prepare('INSERT INTO directions(created_at,body) VALUES(?,?)').run(now(), JSON.stringify(body));
      return this.direction();
    });
  }
  create(data, status = 'preparing') {
    return this.transaction(() => {
      // Blocked attempts must also respect an existing in-flight candidate.
      if (this.db.prepare(`SELECT 1 FROM runs WHERE status IN (${ACTIVE.map(() => '?').join(',')})`).get(...ACTIVE)) {
        throw new Error('active_run: 当前项目已有执行中或等待整合的工作。');
      }
      const id = randomUUID(), at = now();
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(id, status, at, at, data.directionVersion, JSON.stringify(data));
      this.db.prepare('INSERT INTO events(run_id,at,kind,payload) VALUES(?,?,?,?)').run(id, at, 'run.created', JSON.stringify({ status, engine: data.engine, baseSha: data.baseSha }));
      return this.get(id);
    });
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row) throw new Error('run_not_found');
    return { ...JSON.parse(row.data), id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, directionVersion: row.direction_version };
  }
  runs(limit = 40) {
    return this.db.prepare('SELECT id FROM runs ORDER BY created_at DESC,rowid DESC LIMIT ?').all(limit).map(row => this.get(row.id));
  }
  events(id) {
    return this.db.prepare('SELECT * FROM events WHERE run_id=? ORDER BY seq').all(id)
      .map(row => ({ seq: row.seq, at: row.at, kind: row.kind, payload: JSON.parse(row.payload) }));
  }
  update(id, expected, status, kind, patch = {}, payload = {}) {
    return this.transaction(() => {
      const run = this.get(id);
      if (!(Array.isArray(expected) ? expected : [expected]).includes(run.status)) throw new Error(`state_conflict: ${run.status}`);
      const at = now();
      const { id: _, status: __, createdAt, updatedAt, ...data } = { ...run, ...patch };
      this.db.prepare('UPDATE runs SET status=?,updated_at=?,data=? WHERE id=?').run(status, at, JSON.stringify(data), id);
      this.db.prepare('INSERT INTO events(run_id,at,kind,payload) VALUES(?,?,?,?)').run(id, at, kind, JSON.stringify({ ...payload, status }));
      return this.get(id);
    });
  }
  record(id, kind, payload = {}) {
    this.db.prepare('INSERT INTO events(run_id,at,kind,payload) VALUES(?,?,?,?)').run(id, now(), kind, JSON.stringify(payload));
  }
}
