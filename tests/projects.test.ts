import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
const root = mkdtempSync(path.join(os.tmpdir(), "iid-projects-"));
process.env.IID_DATA_DIR = path.join(root, "data");
const { all, save, get, recoverTasks } = await import("../server/db.ts");
const {
  dueProjects,
  taskOrder,
  acceptSuggestion,
  undoSuggestion,
  syncNextCheck,
} = await import("../server/project-store.ts");
const {
  createMaterial,
  captureMaterial,
  scopedPath,
  assertSourceURL,
  parseFile,
} = await import("../server/materials.ts");
const { grantProjectTools, invokeProjectTool } =
  await import("../server/project-tools.ts");
const { registerProjects } = await import("../server/projects.ts");
const { executeProjectTask } = await import("../server/project-runner.ts");
test("项目默认关闭；加速时钟、休眠补查、无活跃资料与队列优先级", async () => {
  const app = Fastify();
  const calls: any[] = [];
  const queue = {
    createTask: (type: string, _: any, extra: any) => {
      calls.push(extra);
      return save("tasks", { type, ...extra, status: "queued" });
    },
    cancelTask: (id: string) =>
      save("tasks", { ...get("tasks", id), status: "cancelled" }),
    emit: () => {},
  };
  const routes = registerProjects(app, queue);
  let p = (
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "时钟验证", priority: 1 },
    })
  ).json();
  const p2 = (
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "另一个项目", priority: 3 },
    })
  ).json();
  await app.inject({
    method: "PATCH",
    url: "/api/projects/" + p2.id,
    payload: { priority: 0, archived: true },
  });
  assert.equal(get("projects", p2.id).priority, 0);
  assert.equal(get("projects", p2.id).archived, true);
  assert.equal(get("projects", p2.id).autoFollowEnabled, false);
  await app.inject({
    method: "PATCH",
    url: "/api/projects/" + p2.id,
    payload: { archived: false },
  });
  assert.equal(get("projects", p2.id).archived, false);
  assert.equal(p.autoFollowEnabled, false);
  assert.equal(p.nextCheckAt, null);
  const m = await createMaterial(p.id, {
    kind: "text",
    content: "实验无变化",
    active: true,
  });
  routes.tick(Date.now() + 24 * 3600000);
  assert.equal(calls.length, 0);
  await app.inject({
    method: "PATCH",
    url: "/api/projects/" + p.id,
    payload: { autoFollowEnabled: true },
  });
  p = get("projects", p.id);
  const due = Date.parse(p.nextCheckAt);
  routes.tick(due - 1);
  assert.equal(calls.length, 0);
  routes.tick(due + 5 * 3600000);
  assert.equal(calls.length, 1);
  routes.tick(due + 5 * 3600000);
  assert.equal(calls.length, 1);
  await app.inject({
    method: "PATCH",
    url: "/api/projects/" + p.id,
    payload: { autoFollowEnabled: false },
  });
  assert.equal(
    all("tasks").find((t) => t.projectId === p.id).status,
    "cancelled",
  );
  assert.equal(get("projects", p.id).nextCheckAt, null);
  const task = { projectId: p.id, type: "project_check", scheduled: true };
  let aiCalls = 0;
  const run = async () => {
    aiCalls++;
    return {
      text: JSON.stringify({
        headline: "无变化",
        stage: "实验",
        health: "on_track",
        markdown: "证据不变",
        blockers: [],
        nextSteps: [],
        meaningfulChange: false,
        evidence: [],
        materials: [],
        suggestions: [],
      }),
    };
  };
  await executeProjectTask(task, new AbortController().signal, run, () => {});
  const reads = get("materials", m.id).lastCheckedAt;
  await executeProjectTask(task, new AbortController().signal, run, () => {});
  assert.equal(aiCalls, 2);
  assert.equal(
    all("projectReports").filter((r) => r.projectId === p.id).length,
    2,
  );
  assert.equal(
    all("projectActivities").filter((a) => a.projectId === p.id && a.unread)
      .length,
    1,
  );
  save("materials", { ...get("materials", m.id), active: false });
  const oldCheck = get("materials", m.id).lastCheckedAt;
  await executeProjectTask(task, new AbortController().signal, run, () => {});
  assert.equal(get("materials", m.id).lastCheckedAt, oldCheck);
  assert.ok(reads);
  save("projects", { ...get("projects", p.id), autoFollowEnabled: true });
  syncNextCheck(p.id);
  assert.equal(get("projects", p.id).nextCheckAt, null);
  const p0 = save("projects", { name: "P0", priority: 0 });
  assert.ok(
    taskOrder(
      { type: "project_chat", createdAt: "z" },
      {
        type: "project_check",
        scheduled: true,
        projectId: p0.id,
        createdAt: "a",
      },
    ) < 0,
  );
  assert.ok(
    taskOrder(
      {
        type: "project_check",
        scheduled: true,
        projectId: p0.id,
        createdAt: "z",
      },
      {
        type: "project_check",
        scheduled: true,
        projectId: p.id,
        createdAt: "a",
      },
    ) < 0,
  );
  assert.deepEqual(
    dueProjects(
      [
        {
          id: "x",
          autoFollowEnabled: true,
          nextCheckAt: new Date(1).toISOString(),
        },
      ],
      [],
      [],
      1e9,
    ),
    [],
  );
  await app.close();
});
test("资料快照、只读路径边界、MCP 项目隔离和失联保留", async () => {
  const p = save("projects", { name: "材料范围" }),
    other = save("projects", { name: "其他项目" });
  const folder = path.join(root, "source");
  mkdirSync(folder);
  const file = path.join(folder, "result.json");
  writeFileSync(file, '{"accuracy":0.6}');
  const m = await createMaterial(p.id, {
    kind: "local",
    path: file,
    active: true,
  });
  assert.equal(readFileSync(file, "utf8"), '{"accuracy":0.6}');
  const snapshot = m.snapshotId;
  await captureMaterial(m);
  assert.equal(get("materials", m.id).snapshotId, snapshot);
  writeFileSync(file, '{"accuracy":0.7}');
  await captureMaterial(get("materials", m.id));
  assert.notEqual(get("materials", m.id).snapshotId, snapshot);
  const dir = await createMaterial(p.id, {
    kind: "local",
    path: folder,
    active: true,
  });
  const token = grantProjectTools(p.id, true);
  const result = await invokeProjectTool(token.token, "list_sources", {});
  assert.ok(JSON.stringify(result).includes("result.json"));
  const another = await createMaterial(other.id, {
    kind: "text",
    content: "secret",
  });
  await assert.rejects(() =>
    invokeProjectTool(token.token, "read_source", { sourceId: another.id }),
  );
  await assert.rejects(async () =>
    invokeProjectTool(token.token, "read_source", {
      sourceId: (
        await createMaterial(p.id, { kind: "text", content: "inactive" })
      ).id,
      refresh: true,
    }),
  );
  assert.equal(
    (
      await invokeProjectTool(token.token, "read_local_file", {
        sourceId: dir.id,
        relativePath: "result.json",
      })
    ).text,
    '{"accuracy":0.7}',
  );
  writeFileSync(path.join(root, "outside.txt"), "private");
  symlinkSync(path.join(root, "outside.txt"), path.join(folder, "escape"));
  await assert.rejects(() => scopedPath(folder, "escape"));
  await assert.rejects(() => scopedPath(folder, "../outside.txt"));
  await assert.rejects(() => scopedPath(folder, file));
  assert.throws(() =>
    assertSourceURL(
      { url: "http://127.0.0.1:8766", adapter: "fspe" },
      "http://127.0.0.1:8766/api/state",
    ),
  );
  assert.throws(() =>
    assertSourceURL(
      { url: "https://example.com" },
      "http://localhost:4317/api/papers",
    ),
  );
  const failure = await captureMaterial({
    ...m,
    path: path.join(root, "missing"),
  });
  assert.ok(failure.error);
  assert.ok(failure.text.includes("accuracy"));
  token.revoke();
  await assert.rejects(() =>
    invokeProjectTool(token.token, "list_sources", {}),
  );
});
test("AI 建议不直接写事项；确认、撤销及修改保护可追溯", async () => {
  const p = save("projects", { name: "建议验证", priority: 1 });
  const m = await createMaterial(p.id, {
    kind: "text",
    content: "实验已完成",
    active: true,
  });
  const fake = async () => ({
    text: JSON.stringify({
      headline: "已完成实验",
      stage: "验收",
      health: "on_track",
      markdown: "已完成",
      blockers: [],
      nextSteps: [],
      meaningfulChange: true,
      evidence: [
        { sourceId: m.id, snapshotId: m.snapshotId, detail: "实验已完成" },
      ],
      materials: [],
      suggestions: [
        {
          action: "create",
          todoId: "",
          title: "导入已完成实验",
          description: "保留来源",
          priority: 2,
          status: "done",
          evidence: [
            { sourceId: m.id, snapshotId: m.snapshotId, detail: "结果" },
          ],
        },
      ],
    }),
  });
  await executeProjectTask(
    { projectId: p.id, type: "project_check" },
    new AbortController().signal,
    fake,
    () => {},
  );
  assert.equal(
    all("projectTodos").filter((t) => t.projectId === p.id).length,
    0,
  );
  const s = all("projectSuggestions").find((s) => s.projectId === p.id);
  assert.equal(s.evidence[0].verified, true);
  const todo = acceptSuggestion(p.id, s.id);
  assert.equal(todo.status, "done");
  assert.equal(todo.priority, 2);
  undoSuggestion(p.id, s.id);
  assert.equal(get("projectTodos", todo.id).removed, true);
  const s2 = save("projectSuggestions", {
    projectId: p.id,
    status: "pending",
    action: "create",
    title: "新的事项",
  });
  const t2 = acceptSuggestion(p.id, s2.id);
  await new Promise((r) => setTimeout(r, 3));
  save("projectTodos", { ...t2, title: "用户改动" });
  assert.throws(() => undoSuggestion(p.id, s2.id));
  assert.throws(() => acceptSuggestion("other", s.id));
  const task = save("tasks", {
    type: "project_check",
    projectId: p.id,
    status: "running",
  });
  recoverTasks();
  assert.equal(get("tasks", task.id).status, "interrupted");
  assert.equal(get("projects", p.id).priority, 1);
});
test("Notebook 和不支持格式解析保留限制", async () => {
  const n = path.join(root, "n.ipynb");
  writeFileSync(
    n,
    JSON.stringify({
      cells: [
        {
          cell_type: "code",
          source: ["a=1"],
          outputs: [{ text: ["result: 1"] }],
        },
      ],
    }),
  );
  assert.match((await parseFile(n)).text, /result: 1/);
  const f = path.join(root, "opaque.bin");
  writeFileSync(f, "opaque");
  assert.equal((await parseFile(f)).unsupported, true);
});

test("前端请求助手：空 POST 可新建会话和检查，JSON 消息正确解析", async () => {
  const { api } = await import("../src/types.ts");
  const app = Fastify();
  registerProjects(app, {
    createTask: (type: string, _paperId?: string, extra: any = {}) =>
      save("tasks", { type, status: "queued", ...extra }),
    cancelTask: () => {},
    emit: () => {},
  });
  const originalFetch = globalThis.fetch;
  const sent: Headers[] = [];
  globalThis.fetch = (async (url: any, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    sent.push(headers);
    const response = await app.inject({
      method: (options.method || "GET") as any,
      url: String(url),
      headers: Object.fromEntries(headers),
      payload: options.body as string | undefined,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const project = await api("/projects", {
      method: "POST",
      body: JSON.stringify({ name: "前端请求回归" }),
    });
    assert.equal(sent.at(-1)?.get("content-type"), "application/json");
    const chat = await api(`/projects/${project.id}/chats`, { method: "POST" });
    assert.equal(chat.projectId, project.id);
    assert.equal(sent.at(-1)?.has("content-type"), false);
    const task = await api(
      `/projects/${project.id}/chats/${chat.id}/messages`,
      { method: "POST", body: JSON.stringify({ content: "请只读总结" }) },
    );
    assert.equal(task.type, "project_chat");
    assert.equal(get("messages", task.messageId).content, "请只读总结");
    assert.equal(sent.at(-1)?.get("content-type"), "application/json");
    const check = await api(`/projects/${project.id}/check`, {
      method: "POST",
    });
    assert.equal(check.type, "project_check");
    assert.equal(sent.at(-1)?.has("content-type"), false);
    const read = await api(`/projects/${project.id}/read`, { method: "POST" });
    assert.equal(read.ok, true);
    const custom = new Headers({ "X-IID-Test": "preserved" });
    await api("/projects", { headers: custom });
    assert.equal(sent.at(-1)?.get("x-iid-test"), "preserved");
    assert.equal(sent.at(-1)?.has("content-type"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("助手模型与思考强度保存，任务快照保持，非法选项被拒绝", async () => {
  const { assistantSettings, updateAssistantSettings, taskSelection } =
    await import("../server/assistant-settings.ts");
  assert.equal(assistantSettings().model, "gpt-6-luna");
  updateAssistantSettings({ model: "gpt-6.1-sol", reasoningEffort: "high" });
  const task = { ...taskSelection({}) };
  assert.equal(task.model, "gpt-6.1-sol");
  assert.equal(task.reasoningEffort, "high");
  updateAssistantSettings({ model: "gpt-6-luna", reasoningEffort: "low" });
  assert.deepEqual(taskSelection(task), {
    model: "gpt-6.1-sol",
    reasoningEffort: "high",
  });
  assert.equal(get("settings", "assistant").reasoningEffort, "low");
  assert.throws(() => updateAssistantSettings({ model: "arbitrary" }));
  assert.throws(() => updateAssistantSettings({ reasoningEffort: "invalid" }));
  updateAssistantSettings({ model: "gpt-6-luna", reasoningEffort: "medium" });
});

test("用户对话导入：中文逗号/Markdown 去重，本地引用、重试幂等及权限边界", async () => {
  const { materialImportTargets, importConversationMaterials } =
    await import("../server/conversation-materials.ts");
  const a = "https://example-team.feishu.cn/wiki/AAA?from=from_copylink",
    b = "https://example-team.feishu.cn/wiki/BBB?from=from_copylink",
    c = "https://example-team.feishu.cn/wiki/CCC?from=from_copylink";
  assert.equal(
    materialImportTargets(`添加资料：[${a}，${b}，${c}](${a}，${b}，${c})`)
      .length,
    3,
  );
  assert.equal(materialImportTargets(`不要添加资料：${a}`).length, 0);
  assert.equal(materialImportTargets(`能不能帮我导入资料？${a}`).length, 1);
  assert.equal(materialImportTargets(`总结这个页面 ${a}`).length, 0);
  const p = save("projects", { name: "导入测试" }),
    msg = save("messages", {
      projectId: p.id,
      chatId: "import-chat",
      role: "user",
      content: `添加资料："${root}/local note.md"`,
    });
  writeFileSync(path.join(root, "local note.md"), "用户提供的实验资料");
  const results = await importConversationMaterials(p.id, msg.id);
  assert.equal(results.length, 1);
  assert.ok(results[0].materialId);
  assert.equal(get("materials", results[0].materialId).active, false);
  assert.equal(
    readFileSync(path.join(root, "local note.md"), "utf8"),
    "用户提供的实验资料",
  );
  await importConversationMaterials(p.id, msg.id);
  assert.equal(all("materials").filter((m) => m.projectId === p.id).length, 1);
  const msg2 = save("messages", {
    projectId: p.id,
    chatId: "import-chat",
    role: "user",
    content: msg.content,
  });
  assert.equal(
    (await importConversationMaterials(p.id, msg2.id))[0].duplicate,
    true,
  );
  const modelMsg = save("messages", {
    projectId: p.id,
    role: "assistant",
    content: msg.content,
  });
  await assert.rejects(() => importConversationMaterials(p.id, modelMsg.id));
  await assert.rejects(() =>
    importConversationMaterials("other-project", msg.id),
  );
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(302, {
      Location: "https://accounts.feishu.cn/accounts/page/login",
    });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as any).port;
    const web = save("messages", {
      projectId: p.id,
      chatId: "import-chat",
      role: "user",
      content: `添加资料：http://127.0.0.1:${port}/private`,
    });
    const [item] = await importConversationMaterials(p.id, web.id);
    assert.ok(item.materialId);
    assert.equal(item.status, "needs_auth");
    assert.match(item.error, /正文尚未读取/);
    assert.equal(get("materials", item.materialId).snapshotId, undefined);
  } finally {
    server.close();
  }
});

test("助手润色项目内容：修改记录、撤销、并发保护及定时/跨项目拒绝", async () => {
  const { undoAssistantEdit } = await import("../server/project-tools.ts");
  const p = save("projects", {
    name: "润色项目",
    goal: "原目标",
    notes: "原备注",
    priority: 1,
    autoFollowEnabled: false,
  });
  const m = await createMaterial(p.id, {
    kind: "text",
    content: "数据",
    title: "原资料",
  });
  const grant = grantProjectTools(p.id, false, {
    allowMetadata: true,
    taskId: "edit-task",
  });
  const current = await invokeProjectTool(grant.token, "get_project", {});
  const change = await invokeProjectTool(grant.token, "update_project", {
    expectedUpdatedAt: current.updatedAt,
    patch: { goal: "润色后的目标", notes: "清晰的备注" },
  });
  assert.equal(change.saved, true);
  assert.equal(get("projects", p.id).goal, "润色后的目标");
  assert.equal(get("projectActivities", change.auditId).before.goal, "原目标");
  assert.equal(get("projectActivities", change.auditId).taskId, "edit-task");
  undoAssistantEdit(p.id, change.auditId);
  assert.equal(get("projects", p.id).goal, "原目标");
  await assert.rejects(() =>
    invokeProjectTool(grant.token, "update_project", {
      expectedUpdatedAt: "stale",
      patch: { goal: "覆盖用户修改" },
    }),
  );
  await assert.rejects(() =>
    invokeProjectTool(grant.token, "update_project", {
      expectedUpdatedAt: get("projects", p.id).updatedAt,
      patch: { priority: 0 },
    }),
  );
  const update = await invokeProjectTool(grant.token, "update_material", {
    sourceId: m.id,
    expectedUpdatedAt: get("materials", m.id).updatedAt,
    patch: { title: "已整理资料", tags: ["论文", "实验"] },
  });
  assert.equal(get("materials", m.id).title, "已整理资料");
  undoAssistantEdit(p.id, update.auditId);
  assert.equal(get("materials", m.id).title, "原资料");
  const other = save("projects", { name: "隔离项目" }),
    foreign = await createMaterial(other.id, {
      kind: "text",
      content: "private",
    });
  await assert.rejects(() =>
    invokeProjectTool(grant.token, "update_material", {
      sourceId: foreign.id,
      expectedUpdatedAt: foreign.updatedAt,
      patch: { title: "越权" },
    }),
  );
  const scheduled = grantProjectTools(p.id, true, { allowMetadata: true });
  await assert.rejects(() =>
    invokeProjectTool(scheduled.token, "update_project", {
      expectedUpdatedAt: get("projects", p.id).updatedAt,
      patch: { goal: "定时任务写入" },
    }),
  );
  const readonly = grantProjectTools(p.id, false);
  await assert.rejects(() =>
    invokeProjectTool(readonly.token, "update_project", {
      expectedUpdatedAt: get("projects", p.id).updatedAt,
      patch: { goal: "无授权写入" },
    }),
  );
  assert.equal(get("projects", p.id).priority, 1);
  assert.equal(get("projects", p.id).autoFollowEnabled, false);
  grant.revoke();
  scheduled.revoke();
  readonly.revoke();
});
