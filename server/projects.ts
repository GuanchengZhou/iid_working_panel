import { importConversationMaterials } from "./conversation-materials.ts";
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import path from "node:path";
import { stat } from "node:fs/promises";
import { all, get, save } from "./db.ts";
import { createMaterial, captureMaterial, scopedPath } from "./materials.ts";
import {
  requireProject,
  requireMaterial,
  projectRows,
  addActivity,
  acceptSuggestion,
  undoSuggestion,
  hasActive,
  syncNextCheck,
  dueProjects,
} from "./project-store.ts";
import { invokeProjectTool, undoAssistantEdit } from "./project-tools.ts";
export function registerProjects(
  app: FastifyInstance,
  queue: {
    createTask: (type: string, paperId?: string, extra?: any) => any;
    cancelTask: (id: string) => void;
    emit: () => void;
  },
) {
  const emit = queue.emit;
  const text = (v: any, max = 20000) => {
    if (typeof v !== "string" || v.length > max)
      throw new Error("文本格式或长度不正确");
    return v;
  };
  function enqueue(projectId: string, scheduled = false) {
    const p = requireProject(projectId);
    if (p.archived) throw new Error("项目已归档");
    const existing = all("tasks").find(
      (t) =>
        t.projectId === projectId &&
        t.type === "project_check" &&
        ["running", "queued"].includes(t.status),
    );
    if (existing) return existing;
    if (scheduled && (!p.autoFollowEnabled || !hasActive(projectId)))
      throw new Error("项目未启用自动跟进或没有活跃资料");
    return queue.createTask("project_check", undefined, {
      projectId,
      scheduled,
    });
  }
  app.get("/api/projects", async () =>
    all("projects").map((p) => ({
      ...p,
      blockers: projectRows("projectReports", p.id)[0]?.blockers || [],
      pendingItems: projectRows("projectTodos", p.id)
        .filter((t) => !t.removed && t.status !== "done")
        .sort((a, b) => a.priority - b.priority)
        .map((t) => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
        })),
      pendingCount: projectRows("projectTodos", p.id).filter(
        (t) => !t.removed && t.status !== "done",
      ).length,
      doneCount: projectRows("projectTodos", p.id).filter(
        (t) => !t.removed && t.status === "done",
      ).length,
      unreadCount: projectRows("projectActivities", p.id).filter(
        (a) => a.unread,
      ).length,
      activeCount: projectRows("materials", p.id).filter(
        (m) => m.active && !m.removed,
      ).length,
      suggestionCount: projectRows("projectSuggestions", p.id).filter(
        (s) => s.status === "pending",
      ).length,
    })),
  );
  app.post<{ Body: any }>("/api/projects", async (req) => {
    const b: any = req.body,
      name = text(b.name, 300).trim();
    if (!name) throw new Error("项目名称不能为空");
    const p = save("projects", {
      name,
      goal: text(b.goal || ""),
      notes: text(b.notes || ""),
      priority: [0, 1, 2, 3].includes(b.priority) ? b.priority : 1,
      status: "active",
      archived: false,
      autoFollowEnabled: false,
      nextCheckAt: null,
      health: "unknown",
      assistantName: b.assistantName
        ? text(b.assistantName, 100)
        : name + " · AI 助手",
    });
    emit();
    return p;
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    const p = requireProject(req.params.id);
    return {
      project: p,
      materials: projectRows("materials", p.id)
        .filter((m) => !m.removed)
        .map((m) => {
          const { content, ...rest } = m;
          return rest;
        }),
      todos: projectRows("projectTodos", p.id).filter((t) => !t.removed),
      reports: projectRows("projectReports", p.id),
      suggestions: projectRows("projectSuggestions", p.id),
      activities: projectRows("projectActivities", p.id),
      tasks: all("tasks").filter((t) => t.projectId === p.id),
      chats: projectRows("chats", p.id),
    };
  });
  app.patch<{ Params: { id: string }; Body: any }>(
    "/api/projects/:id",
    async (req) => {
      const p = requireProject(req.params.id),
        b: any = req.body,
        patch: any = {};
      for (const k of ["name", "goal", "notes", "assistantName"])
        if (k in b)
          patch[k] = text(
            b[k],
            k === "name" || k === "assistantName" ? 300 : 20000,
          );
      if (patch.name !== undefined && !patch.name.trim())
        throw new Error("项目名称不能为空");
      if ("priority" in b) {
        if (![0, 1, 2, 3].includes(b.priority)) throw new Error("优先级无效");
        patch.priority = b.priority;
      }
      if ("status" in b) {
        if (!["active", "paused", "completed"].includes(b.status))
          throw new Error("项目状态无效");
        patch.status = b.status;
      }
      if ("archived" in b) patch.archived = !!b.archived;
      if ("autoFollowEnabled" in b)
        patch.autoFollowEnabled = !!b.autoFollowEnabled;
      if (patch.archived) patch.autoFollowEnabled = false;
      if (p.archived && patch.autoFollowEnabled)
        throw new Error("请先恢复已归档项目");
      if (patch.autoFollowEnabled === false) {
        patch.nextCheckAt = null;
        for (const task of all("tasks"))
          if (
            task.projectId === p.id &&
            task.scheduled &&
            task.status === "queued"
          )
            queue.cancelTask(task.id);
      }
      save("projects", { ...p, ...patch });
      const result = syncNextCheck(p.id);
      emit();
      return result;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/check",
    async (req) => {
      const task = enqueue(req.params.id);
      emit();
      return task;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/read",
    async (req) => {
      requireProject(req.params.id);
      for (const a of projectRows("projectActivities", req.params.id))
        if (a.unread) save("projectActivities", { ...a, unread: false });
      emit();
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/projects/:id/materials",
    async (req) => {
      requireProject(req.params.id);
      const result = await createMaterial(req.params.id, req.body);
      syncNextCheck(req.params.id);
      emit();
      return result;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/uploads",
    async (req) => {
      requireProject(req.params.id);
      const results: any[] = [];
      for await (const file of req.files()) {
        try {
          results.push(
            await createMaterial(
              req.params.id,
              {},
              { filename: file.filename, buffer: await file.toBuffer() },
            ),
          );
        } catch (e: any) {
          results.push({ filename: file.filename, error: e.message });
        }
      }
      emit();
      return results;
    },
  );
  app.patch<{ Params: { id: string; mid: string }; Body: any }>(
    "/api/projects/:id/materials/:mid",
    async (req) => {
      const m = requireMaterial(req.params.id, req.params.mid),
        b: any = req.body,
        patch: any = {};
      for (const k of ["title", "description", "category", "summary"])
        if (k in b) patch[k] = text(b[k]);
      if ("tags" in b) {
        if (
          !Array.isArray(b.tags) ||
          b.tags.length > 30 ||
          b.tags.some((v: any) => typeof v !== "string" || v.length > 100)
        )
          throw new Error("标签格式不正确");
        patch.tags = b.tags;
      }
      if ("active" in b) patch.active = !!b.active;
      if ("removed" in b) patch.removed = !!b.removed;
      const result = save("materials", { ...m, ...patch });
      syncNextCheck(m.projectId);
      emit();
      return result;
    },
  );
  app.post<{ Params: { id: string; mid: string } }>(
    "/api/projects/:id/materials/:mid/refresh",
    async (req) => {
      const m = requireMaterial(req.params.id, req.params.mid);
      const result = await captureMaterial(m);
      emit();
      return result;
    },
  );
  app.get<{ Params: { id: string; mid: string } }>(
    "/api/projects/:id/materials/:mid/snapshots",
    async (req) => {
      requireMaterial(req.params.id, req.params.mid);
      return projectRows("materialSnapshots", req.params.id).filter(
        (s) => s.materialId === req.params.mid,
      );
    },
  );
  app.get<{
    Params: { id: string; mid: string };
    Querystring: { relative?: string; snapshotId?: string };
  }>("/api/projects/:id/materials/:mid/file", async (req, reply) => {
    const m = requireMaterial(req.params.id, req.params.mid);
    if (!["local", "upload"].includes(m.kind))
      throw new Error("资料没有本地附件");
    const snapshot = req.query.snapshotId
      ? get("materialSnapshots", req.query.snapshotId)
      : null;
    if (
      req.query.snapshotId &&
      (!snapshot ||
        snapshot.materialId !== m.id ||
        snapshot.projectId !== m.projectId ||
        !snapshot.imagePath)
    )
      throw new Error("图片快照不存在");
    const file =
      snapshot?.imagePath ||
      (m.isDirectory
        ? await scopedPath(m.path, req.query.relative || "")
        : m.path);
    if (!(await stat(file)).isFile()) throw new Error("请选择目录内的文件");
    const ext = path.extname(file).toLowerCase(),
      mime =
        ext === ".pdf"
          ? "application/pdf"
          : ext === ".png"
            ? "image/png"
            : [".jpg", ".jpeg"].includes(ext)
              ? "image/jpeg"
              : ext === ".webp"
                ? "image/webp"
                : "application/octet-stream";
    return reply
      .type(mime)
      .header(
        "Content-Disposition",
        `${mime === "application/octet-stream" ? "attachment" : "inline"}; filename="attachment${ext.replace(/[^.a-z0-9]/g, "")}"`,
      )
      .send(createReadStream(file));
  });
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/projects/:id/todos",
    async (req) => {
      requireProject(req.params.id);
      const b: any = req.body,
        title = text(b.title, 500).trim();
      if (!title) throw new Error("事项标题不能为空");
      if (b.status && !["todo", "doing", "blocked", "done"].includes(b.status))
        throw new Error("事项状态无效");
      if (b.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate))
        throw new Error("截止日期格式错误");
      const result = save("projectTodos", {
        projectId: req.params.id,
        title,
        description: text(b.description || ""),
        priority: [0, 1, 2, 3].includes(b.priority) ? b.priority : 2,
        status: b.status || "todo",
        dueDate: b.dueDate || "",
        origin: "user",
        completedAt: b.status === "done" ? new Date().toISOString() : null,
      });
      emit();
      return result;
    },
  );
  app.patch<{ Params: { id: string; tid: string }; Body: any }>(
    "/api/projects/:id/todos/:tid",
    async (req) => {
      const t = get("projectTodos", req.params.tid);
      if (!t || t.projectId !== req.params.id) throw new Error("事项不存在");
      const b: any = req.body,
        patch: any = {};
      for (const k of ["title", "description", "dueDate"])
        if (k in b) patch[k] = text(b[k], k === "title" ? 500 : 20000);
      if (patch.title !== undefined && !patch.title.trim())
        throw new Error("标题不能为空");
      if (patch.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate))
        throw new Error("日期格式错误");
      if ("priority" in b) {
        if (![0, 1, 2, 3].includes(b.priority)) throw new Error("优先级无效");
        patch.priority = b.priority;
      }
      if ("status" in b) {
        if (!["todo", "doing", "blocked", "done"].includes(b.status))
          throw new Error("状态无效");
        patch.status = b.status;
        patch.completedAt =
          b.status === "done" ? new Date().toISOString() : null;
      }
      if ("removed" in b) patch.removed = !!b.removed;
      const result = save("projectTodos", { ...t, ...patch });
      addActivity(req.params.id, "事项已更新", result.title, {
        unread: false,
        todoId: result.id,
      });
      emit();
      return result;
    },
  );
  app.post<{ Params: { id: string; sid: string }; Body: { action: string } }>(
    "/api/projects/:id/suggestions/:sid",
    async (req) => {
      const { id, sid } = req.params;
      let result;
      if (req.body.action === "accept") result = acceptSuggestion(id, sid);
      else if (req.body.action === "undo") result = undoSuggestion(id, sid);
      else if (req.body.action === "reject") {
        const s = get("projectSuggestions", sid);
        if (!s || s.projectId !== id || s.status !== "pending")
          throw new Error("建议不存在或已处理");
        result = save("projectSuggestions", { ...s, status: "rejected" });
      } else throw new Error("操作无效");
      emit();
      return result;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/chats",
    async (req) => {
      const p = requireProject(req.params.id);
      const chat = save("chats", {
        projectId: p.id,
        title: p.assistantName || p.name + " · AI 助手",
      });
      emit();
      return chat;
    },
  );
  app.post<{ Params: { id: string; cid: string }; Body: { content: string } }>(
    "/api/projects/:id/chats/:cid/messages",
    async (req) => {
      requireProject(req.params.id);
      const c = get("chats", req.params.cid);
      if (!c || c.projectId !== req.params.id)
        throw new Error("会话不属于该项目");
      if (
        all("tasks").some(
          (t) => t.chatId === c.id && ["running", "queued"].includes(t.status),
        )
      )
        throw new Error("请等待回复或先停止");
      const content = text(req.body.content, 50000).trim();
      if (!content) throw new Error("请输入问题");
      const message = save("messages", {
        projectId: req.params.id,
        chatId: c.id,
        role: "user",
        content,
      });
      return queue.createTask("project_chat", undefined, {
        projectId: req.params.id,
        chatId: c.id,
        messageId: message.id,
      });
    },
  );
  app.post<{ Params: { id: string; cid: string; mid: string } }>(
    "/api/projects/:id/chats/:cid/messages/:mid/import",
    async (req) => {
      const { id, cid, mid } = req.params;
      const chat = get("chats", cid),
        message = get("messages", mid);
      if (
        !chat ||
        chat.projectId !== id ||
        !message ||
        message.chatId !== cid ||
        message.role !== "user"
      )
        throw new Error("原始消息不属于当前项目会话");
      const results = await importConversationMaterials(id, mid);
      if (results.length) {
        const receipt = all("messages").find(
          (m) => m.projectId === id && m.importReceiptFor === mid,
        );
        save("messages", {
          ...receipt,
          projectId: id,
          chatId: cid,
          role: "system",
          importReceiptFor: mid,
          content:
            "已根据这条原始请求补充处理资料导入：\n\n" +
            results
              .map((r: any, i: number) =>
                r.materialId
                  ? `- [资料 ${i + 1}](material:${r.materialId})：${r.duplicate ? "已在资料库" : "已保存到项目资料"}${r.error ? "；" + r.error : r.status === "unsupported" ? "；已保留原件，格式解析受限" : "；正文已采集"}`
                  : `- 资料 ${i + 1} 未导入：${r.error}`,
              )
              .join("\n") +
            "\n\n新增资料默认非活跃，自动跟进设置保持不变。",
        });
      }
      emit();
      return { results };
    },
  );
  app.post<{ Body: { name: string; args: any } }>(
    "/api/project-tools",
    async (req, reply) => {
      const bearer = req.headers.authorization?.replace(/^Bearer /, "") || "";
      try {
        const result = await invokeProjectTool(
          bearer,
          req.body.name,
          req.body.args || {},
        );
        if (result?.auditId) emit();
        return result;
      } catch (e: any) {
        return reply.code(403).send({ error: e.message });
      }
    },
  );
  app.post<{ Params: { id: string; aid: string } }>(
    "/api/projects/:id/edits/:aid/undo",
    async (req) => {
      const result = undoAssistantEdit(req.params.id, req.params.aid);
      emit();
      return result;
    },
  );
  function tick(now = Date.now()) {
    for (const p of dueProjects(
      all("projects"),
      all("materials"),
      all("tasks"),
      now,
    )) {
      save("projects", {
        ...p,
        nextCheckAt: new Date(now + 3600000).toISOString(),
      });
      enqueue(p.id, true);
    }
  }
  return { enqueue, tick };
}
