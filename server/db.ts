import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const DATA = path.resolve(process.env.IID_DATA_DIR || "data");
mkdirSync(DATA, { recursive: true });
for (const dir of ["pdfs", "snapshots", "contexts", "codex", "projects"])
  mkdirSync(path.join(DATA, dir), { recursive: true });
export const db = new DatabaseSync(path.join(DATA, "workbench.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
);
export const tables = [
  "papers",
  "annotations",
  "chats",
  "messages",
  "analyses",
  "tasks",
  "snapshots",
  "projects",
  "materials",
  "materialSnapshots",
  "projectTodos",
  "projectReports",
  "projectSuggestions",
  "projectActivities",
  "settings",
  "reviewCases", "reviewDocuments", "reviewIssues", "reviewOutputs",
  "reviewDraftVersions", "reviewAnnotations",
] as const;
export type Table = (typeof tables)[number];
for (const table of tables)
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, paperId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${table}_paper ON ${table}(paperId);`,
  );
for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!columns.some((c) => c.name === "projectId"))
    db.exec(`ALTER TABLE ${table} ADD COLUMN projectId TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_project ON ${table}(projectId)`);
}
export function all<T = any>(table: Table): T[] {
  return (
    db
      .prepare(`SELECT body FROM ${table} ORDER BY createdAt DESC`)
      .all() as any[]
  ).map((r) => JSON.parse(r.body));
}
export function get<T = any>(table: Table, id: string): T | undefined {
  const row = db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id) as any;
  return row ? JSON.parse(row.body) : undefined;
}
export function save<T extends Record<string, any>>(
  table: Table,
  value: T,
): T & { id: string; createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  const item = {
    ...value,
    id: value.id || randomUUID(),
    createdAt: value.createdAt || now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO ${table}(id,paperId,createdAt,updatedAt,body,projectId) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paperId=excluded.paperId,projectId=excluded.projectId,updatedAt=excluded.updatedAt,body=excluded.body`,
  ).run(
    item.id,
    value.paperId || null,
    item.createdAt,
    now,
    JSON.stringify(item),
    value.projectId || null,
  );
  return item;
}
export function remove(table: Table, id: string) {
  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
}
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function recoverTasks() {
  for (const t of all("tasks"))
    if (["running", "queued"].includes(t.status))
      save("tasks", {
        ...t,
        status: "interrupted",
        error: "服务已重启，请重试此任务。",
        finishedAt: new Date().toISOString(),
      });
}
