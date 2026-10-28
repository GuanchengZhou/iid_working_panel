import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { DATA, all, get, save, db } from "./db.ts";
import {
  download,
  importPDF,
  parseSource,
  linkMetadata,
  MAX_PDF,
} from "./import.ts";
import {
  createTask,
  cancelTask,
  retryTask,
  resumeReview,
  events,
  health,
  initQueue,
  stopQueue,
  emit,
} from "./ai.ts";
import { registerProjects } from "./projects.ts";
import { registerReviews } from "./reviews.ts";
import { seedFSPE } from "./project-seed.ts";
import {
  assistantSettings,
  updateAssistantSettings,
  ASSISTANT_MODELS,
  REASONING_EFFORTS,
} from "./assistant-settings.ts";
const port = Number(process.env.IID_PORT || 4317);
const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: MAX_PDF, files: 50 } });
app.addHook("onRequest", async (req, reply) => {
  const host = req.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
    return reply.code(403).send({ error: "仅支持本机访问" });
  const origin = req.headers.origin;
  if (
    origin &&
    !/^http:\/\/(localhost|127\.0\.0\.1):(4317|4318|5173)$/.test(origin)
  )
    return reply.code(403).send({ error: "来源不被允许" });
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "no-referrer");
});
app.setErrorHandler((e: any, _req, reply) => {
  app.log.error(e);
  reply
    .code(
      e.statusCode && e.statusCode >= 400 && e.statusCode < 500
        ? e.statusCode
        : 400,
    )
    .send({ error: e.message || "操作失败" });
});
function paper(id: string) {
  const p = get("papers", id);
  if (!p) throw new Error("文献不存在");
  return p;
}
function trimmed(v: any, max = 20000) {
  if (typeof v !== "string" || v.length > max)
    throw new Error("文本格式或长度不正确");
  return v;
}
function listPaper(p: any) {
  const { pages, ...rest } = p;
  return { ...rest, hasText: pages.some((x: string) => x.trim()) };
}
registerReviews(app, createTask, emit);
app.get("/api/health", async () => ({
  ...(await health()),
  dataDirectory: DATA,
}));
app.get("/api/assistant-settings", async () => ({
  ...assistantSettings(),
  models: ASSISTANT_MODELS,
  reasoningEfforts: REASONING_EFFORTS,
}));
app.patch<{ Body: any }>("/api/assistant-settings", async (req) => {
  const value = updateAssistantSettings(req.body);
  emit();
  return {
    ...value,
    models: ASSISTANT_MODELS,
    reasoningEfforts: REASONING_EFFORTS,
  };
});
app.get("/api/papers", async () => all("papers").map(listPaper));
app.get<{ Params: { id: string } }>("/api/papers/:id", async (req) =>
  listPaper(paper(req.params.id)),
);
app.get<{ Params: { id: string } }>(
  "/api/papers/:id/pdf",
  async (req, reply) => {
    const p = paper(req.params.id);
    return reply
      .type("application/pdf")
      .header("Content-Disposition", 'inline; filename="paper.pdf"')
      .header("Cache-Control", "private, max-age=3600")
      .send(createReadStream(path.join(DATA, "pdfs", p.file)));
  },
);
app.get<{ Params: { id: string } }>(
  "/api/papers/:id/pages",
  async (req) => paper(req.params.id).pages,
);
app.post("/api/import/files", async (req, reply) => {
  const results: any[] = [];
  for await (const file of req.files()) {
    try {
      const buffer = await file.toBuffer();
      const result = await importPDF(buffer, file.filename);
      results.push({
        filename: file.filename,
        ...result,
        paper: listPaper(result.paper),
      });
    } catch (e: any) {
      results.push({ filename: file.filename, error: e.message });
    }
  }
  if (!results.length)
    return reply.code(400).send({ error: "请选择 PDF 文件" });
  emit();
  return results;
});
app.post<{ Body: { url: string } }>("/api/import/url", async (req) => {
  const url = trimmed(req.body.url, 2000);
  const source = parseSource(url);
  const duplicate = all("papers").find(
    (p) => source.identifier && p.identifier === source.identifier,
  );
  if (duplicate) return { paper: listPaper(duplicate), duplicate: true };
  const [buffer, metadata] = await Promise.all([
    download(source.url),
    linkMetadata(url),
  ]);
  const result = await importPDF(
    buffer,
    decodeURIComponent(
      new URL(source.url).pathname.split("/").pop() || "paper.pdf",
    ),
    { ...source, ...metadata, sourceUrl: url },
  );
  emit();
  return { ...result, paper: listPaper(result.paper) };
});
app.patch<{ Params: { id: string }; Body: any }>(
  "/api/papers/:id",
  async (req) => {
    const p = paper(req.params.id),
      b: any = req.body;
    const patch: any = {};
    for (const key of [
      "title",
      "authors",
      "abstract",
      "year",
      "venue",
      "meaning",
      "note",
      "openreviewUrl",
    ])
      if (key in b)
        patch[key] = trimmed(b[key], key === "note" ? 1000000 : 20000);
    if ("title" in patch && !patch.title.trim())
      throw new Error("标题不能为空");
    if ("tags" in b) {
      if (
        !Array.isArray(b.tags) ||
        b.tags.length > 100 ||
        b.tags.some((x: any) => typeof x !== "string" || x.length > 80)
      )
        throw new Error("标签格式不正确");
      patch.tags = [
        ...new Set(b.tags.map((x: string) => x.trim()).filter(Boolean)),
      ];
    }
    if ("manualScore" in b) {
      if (
        b.manualScore !== null &&
        (!Number.isInteger(b.manualScore) ||
          b.manualScore < 1 ||
          b.manualScore > 5)
      )
        throw new Error("评分应为1–5或空");
      patch.manualScore = b.manualScore;
    }
    if ("status" in b) {
      if (!["unread", "reading", "read"].includes(b.status))
        throw new Error("阅读状态无效");
      patch.status = b.status;
    }
    if ("lastPage" in b)
      patch.lastPage = Math.max(
        1,
        Math.min(p.pageCount, Math.round(Number(b.lastPage) || 1)),
      );
    if ("zoom" in b)
      patch.zoom = Math.max(0.5, Math.min(2, Number(b.zoom) || 1));
    const updated = save("papers", { ...p, ...patch });
    return listPaper(updated);
  },
);
app.get<{ Params: { id: string } }>(
  "/api/papers/:id/annotations",
  async (req) => all("annotations").filter((a) => a.paperId === req.params.id),
);
app.post<{ Params: { id: string }; Body: any }>(
  "/api/papers/:id/annotations",
  async (req) => {
    const p = paper(req.params.id),
      b: any = req.body;
    if (
      !Number.isInteger(b.page) ||
      b.page < 1 ||
      b.page > p.pageCount ||
      !Array.isArray(b.rects) ||
      !b.rects.length ||
      b.rects.length > 1000
    )
      throw new Error("批注位置无效");
    for (const r of b.rects)
      if (
        ["x", "y", "width", "height"].some(
          (k) =>
            typeof r[k] !== "number" ||
            !Number.isFinite(r[k]) ||
            r[k] < 0 ||
            r[k] > 1.01,
        )
      )
        throw new Error("批注坐标无效");
    return save("annotations", {
      paperId: p.id,
      page: b.page,
      rects: b.rects,
      text: trimmed(b.text, 100000),
      comment: trimmed(b.comment || ""),
      color: ["yellow", "green", "purple"].includes(b.color)
        ? b.color
        : "yellow",
    });
  },
);
app.patch<{ Params: { id: string }; Body: any }>(
  "/api/annotations/:id",
  async (req) => {
    const a = get("annotations", req.params.id);
    if (!a) throw new Error("批注不存在");
    const b: any = req.body;
    return save("annotations", {
      ...a,
      comment: "comment" in b ? trimmed(b.comment) : a.comment,
      color: ["yellow", "green", "purple"].includes(b.color)
        ? b.color
        : a.color,
    });
  },
);
app.delete<{ Params: { id: string } }>("/api/annotations/:id", async (req) => {
  db.prepare("DELETE FROM annotations WHERE id=?").run(req.params.id);
  return { ok: true };
});
app.get<{ Querystring: { paperId?: string } }>("/api/analyses", async (req) =>
  all("analyses").filter(
    (x) => !req.query.paperId || x.paperId === req.query.paperId,
  ),
);
app.get<{ Params: { id: string } }>("/api/snapshots/:id", async (req) => {
  const s = get("snapshots", req.params.id);
  if (!s) throw new Error("快照不存在");
  return s;
});
app.get("/api/tasks", async () => all("tasks").map(({input,comparison,chatHistory,...task})=>task));
app.post<{ Body: { type: string; paperId: string } }>(
  "/api/tasks",
  async (req) => {
    const b = req.body;
    if (!["paper", "openreview"].includes(b.type))
      throw new Error("任务类型无效");
    paper(b.paperId);
    if (
      all("tasks").some(
        (t) =>
          t.paperId === b.paperId &&
          t.type === b.type &&
          ["running", "queued", "waiting_url", "waiting_selection"].includes(
            t.status,
          ),
      )
    )
      throw new Error("已有同类型任务，请查看任务面板");
    return createTask(b.type, b.paperId);
  },
);
app.post<{ Params: { id: string } }>("/api/tasks/:id/cancel", async (req) => {
  cancelTask(req.params.id);
  return { ok: true };
});
app.post<{ Params: { id: string } }>("/api/tasks/:id/retry", async (req) => {
  retryTask(req.params.id);
  return { ok: true };
});
app.post<{
  Params: { id: string };
  Body: { url?: string; manualText?: string };
}>("/api/tasks/:id/material", async (req) => {
  resumeReview(req.params.id, req.body.url, req.body.manualText);
  return { ok: true };
});
app.get("/api/chats", async () => all("chats").filter((c) => !c.projectId));
app.post<{ Body: { paperId?: string; title?: string } }>(
  "/api/chats",
  async (req) => {
    if (req.body.paperId) paper(req.body.paperId);
    return save("chats", {
      paperId: req.body.paperId || null,
      title: req.body.title?.slice(0, 100) || "新的科研会话",
    });
  },
);
app.get<{ Params: { id: string } }>("/api/chats/:id/messages", async (req) =>
  all("messages")
    .filter((m) => m.chatId === req.params.id)
    .reverse(),
);
app.post<{
  Params: { id: string };
  Body: { content: string; attachments?: string };
}>("/api/chats/:id/messages", async (req) => {
  const c = get("chats", req.params.id);
  if (!c || c.projectId) throw new Error("请通过项目工作区访问项目会话");
  if (
    all("tasks").some(
      (t) => t.chatId === c.id && ["running", "queued"].includes(t.status),
    )
  )
    throw new Error("请等待当前回复或先停止");
  const content = trimmed(req.body.content, 50000).trim();
  if (!content) throw new Error("消息不能为空");
  const message = save("messages", {
    chatId: c.id,
    paperId: c.paperId,
    role: "user",
    content,
    attachments: req.body.attachments
      ? trimmed(req.body.attachments, 500000)
      : "",
  });
  if (c.title === "新的科研会话")
    save("chats", { ...c, title: content.slice(0, 28) });
  return createTask("chat", c.paperId, { chatId: c.id, messageId: message.id });
});
app.get("/api/events", async (req, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  reply.raw.write("data: connected\n\n");
  const listener = () => reply.raw.write("data: update\n\n");
  events.on("update", listener);
  const timer = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20000);
  req.raw.on("close", () => {
    clearInterval(timer);
    events.off("update", listener);
  });
});
const projects = registerProjects(app, { createTask, cancelTask, emit });
const dist = path.resolve("dist");
if (existsSync(dist)) {
  await app.register(staticPlugin, { root: dist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "接口不存在" })
      : reply.sendFile("index.html"),
  );
} else
  app.get("/", async (_req, reply) =>
    reply.type("text/html").send("<p>请先运行 npm run build，再重启服务。</p>"),
  );
initQueue();
await app.listen({ host: "127.0.0.1", port });
const projectTimer = setInterval(() => {
  try {
    projects.tick();
  } catch (e) {
    app.log.error(e);
  }
}, 30000);
projectTimer.unref();
projects.tick();
void seedFSPE(projects.enqueue).catch((e) =>
  app.log.error(e, "FSPE initialization"),
);
void health().then((x) => app.log.info({ codex: x }, "Codex status"));
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    clearInterval(projectTimer);
    stopQueue();
    setTimeout(() => process.exit(0), 250).unref();
    void app.close();
  });
