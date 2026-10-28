import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(path.join(tmpdir(), "iid-bootstrap-"));
process.env.IID_DATA_DIR = dir;
delete process.env.IID_PROJECT_SEED_FILE;
delete process.env.IID_SKIP_SEED;
const { all, save, db } = await import("../server/db.ts");
const { seedFSPE } = await import("../server/project-seed.ts");
test("空白安装不创建个人项目，不自动调用AI；私有初始化幂等且保留用户编辑", async () => {
  let calls = 0;
  const enqueue = () => ({ id: "example-task-" + ++calls });
  await seedFSPE(enqueue);
  assert.equal(all("projects").length, 0);
  assert.equal(calls, 0);
  const config = {
    project: { seedKey: "example-project", name: "示例项目", goal: "初始目标" },
    materials: [
      {
        seedKey: "example-context",
        kind: "text",
        title: "背景材料",
        content: "Synthetic context",
        active: false,
      },
    ],
  };
  writeFileSync(
    path.join(dir, "local-project-seed.json"),
    JSON.stringify(config),
  );
  await seedFSPE(enqueue);
  assert.equal(all("projects").length, 1);
  assert.equal(all("materials").length, 1);
  assert.equal(calls, 0);
  const project = all("projects")[0];
  save("projects", { ...project, goal: "用户修改的目标" });
  await seedFSPE(enqueue);
  assert.equal(all("projects")[0].goal, "用户修改的目标");
  assert.equal(all("materials").length, 1);
  writeFileSync(
    path.join(dir, "local-project-seed.json"),
    JSON.stringify({ ...config, runInitialCheck: true }),
  );
  await seedFSPE(enqueue);
  await seedFSPE(enqueue);
  assert.equal(calls, 1);
  process.env.IID_SKIP_SEED = "1";
  writeFileSync(path.join(dir, "local-project-seed.json"), "invalid json");
  await seedFSPE(enqueue);
  assert.equal(calls, 1);
});
test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
