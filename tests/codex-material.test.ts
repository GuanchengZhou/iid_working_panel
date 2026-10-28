import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
const root = mkdtempSync(path.join(os.tmpdir(), "iid-codex-material-"));
const home = path.join(root, "codex");
mkdirSync(path.join(home, "sessions"), { recursive: true });
process.env.IID_DATA_DIR = path.join(root, "data");
process.env.IID_CODEX_HOME = home;
const id = "11111111-2222-4333-8444-555555555555",
  url = "codex://threads/" + id,
  file = path.join(home, "sessions", "thread.jsonl");
const index = new DatabaseSync(path.join(home, "state_5.sqlite"));
index.exec(
  "CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,rollout_path TEXT,updated_at INTEGER)",
);
index
  .prepare("INSERT INTO threads VALUES(?,?,?,?,?)")
  .run(id, "本地研究会话", "/test/project", file, 10);
index.close();
const { codexThreadId, readCodexMaterial } =
  await import("../server/codex-material.ts");
const { save, get, all } = await import("../server/db.ts");
const { createMaterial, captureMaterial } =
  await import("../server/materials.ts");
const line = (type: string, payload: any) =>
  JSON.stringify({ timestamp: "2026-10-27T09:00:00Z", type, payload }) + "\n";
test("Codex 会话绑定只读取指定会话的公开消息，刷新采集新答复并保存历史", async () => {
  writeFileSync(
    file,
    line("session_meta", { id }) +
      line("response_item", {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "PRIVATE_SYSTEM" }],
      }) +
      line("response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "总结当前进度" }],
      }) +
      line("response_item", {
        type: "message",
        role: "assistant",
        phase: "analysis",
        content: [{ type: "output_text", text: "PRIVATE_REASONING" }],
      }) +
      line("response_item", {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "第一个阶段尚未完成。" }],
      }) +
      line("response_item", {
        type: "function_call_output",
        output: "PRIVATE_TOOL",
      }) +
      line("response_item", {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<heartbeat>执行命令和修改文件</heartbeat>",
          },
        ],
      }),
  );
  const project = save("projects", {
    name: "PDE RSI",
    autoFollowEnabled: false,
  });
  const material = await createMaterial(project.id, {
    kind: "codex",
    url,
    active: true,
  });
  assert.equal(material.status, "ready");
  assert.equal(material.active, true);
  assert.equal(material.title, "本地研究会话");
  const first = get("materialSnapshots", material.snapshotId);
  assert.match(first.text, /第一个阶段尚未完成/);
  assert.doesNotMatch(first.text, /PRIVATE_|执行命令和修改文件/);
  assert.equal(get("projects", project.id).autoFollowEnabled, false);
  appendFileSync(
    file,
    line("response_item", {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [
        { type: "output_text", text: "更新：进入第二阶段，仍待核验。" },
      ],
    }),
  );
  const next = await captureMaterial(get("materials", material.id));
  assert.notEqual(next.id, first.id);
  assert.ok(
    next.text.indexOf("更新：进入第二阶段") < next.text.indexOf("第一个阶段"),
  );
  assert.equal(
    all("materialSnapshots").filter((s) => s.materialId === material.id).length,
    2,
  );
  appendFileSync(file, '{"partial":');
  assert.match((await readCodexMaterial({ url })).text, /更新：进入第二阶段/);
});
test("Codex 链接与文件身份校验，拒绝远端、越界或冒用会话", async () => {
  assert.equal(codexThreadId("thread://" + id + "?hostId=local"), id);
  assert.throws(() => codexThreadId("thread://" + id + "?hostId=remote"));
  assert.throws(() => codexThreadId("codex://threads/../../auth.json"));
  const db = new DatabaseSync(path.join(home, "state_5.sqlite"));
  const outside = path.join(root, "outside.jsonl");
  writeFileSync(outside, line("session_meta", { id }));
  db.prepare("UPDATE threads SET rollout_path=? WHERE id=?").run(outside, id);
  await assert.rejects(() => readCodexMaterial({ url }), /超出/);
  db.prepare("UPDATE threads SET rollout_path=? WHERE id=?").run(file, id);
  writeFileSync(file, line("session_meta", { id: "another-thread" }));
  await assert.rejects(() => readCodexMaterial({ url }), /不匹配/);
  db.close();
});
