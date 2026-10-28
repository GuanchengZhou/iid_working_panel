import { realpath } from "node:fs/promises";
import { get, save } from "./db.ts";
import {
  requireProject,
  projectRows,
  addActivity,
  syncNextCheck,
} from "./project-store.ts";
import { createMaterial } from "./materials.ts";
export function materialImportTargets(content: string) {
  const request = content.trim();
  const leading = request.split(/[\n。！？?]/)[0];
  if (
    /(?<!能)(?:不要|无需|请勿|禁止|别|不能).{0,6}(?:添加|导入|收录|保存|绑定|加入|纳入)|如何|怎么|为什么|是否支持/.test(
      leading,
    )
  )
    return [];
  if (
    !/(?:添加|导入|收录|保存|绑定|加入|纳入).{0,30}(?:资料|材料|链接|网页|文件|文档)|(?:资料|材料|链接|网页|文档|文件).{0,20}(?:添加|导入|收录|绑定)/.test(
      leading,
    )
  )
    return [];
  const targets: { kind: "web" | "local"; source: string }[] = [];
  for (const match of request.matchAll(
    /https?:\/\/[^\s<>\[\](){}"'“”‘’，、；,;]+/gi,
  )) {
    try {
      const u = new URL(match[0].replace(/[。！!]+$/, ""));
      if (u.username || u.password) continue;
      u.hash = "";
      for (const key of [...u.searchParams.keys()])
        if (key === "from" || key.startsWith("utm_"))
          u.searchParams.delete(key);
      targets.push({ kind: "web", source: u.href });
    } catch {}
  }
  for (const match of request.matchAll(
    /["“‘`](\/(?!\/)[^"”’`\n]+)["”’`]|(?:^|[\n\s：:])(\/(?!\/)[^\s，、；,;\]\)]+)/g,
  ))
    targets.push({
      kind: "local",
      source: (match[1] || match[2]).replace(/[。！!]+$/, ""),
    });
  return targets
    .filter(
      (t, i, a) =>
        a.findIndex((v) => v.kind === t.kind && v.source === t.source) === i,
    )
    .slice(0, 20);
}
const locks = new Map<string, Promise<any>>();
export async function importConversationMaterials(
  projectId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  const prior = locks.get(projectId) || Promise.resolve();
  const next = prior
    .catch(() => {})
    .then(() => perform(projectId, messageId, signal));
  locks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (locks.get(projectId) === next) locks.delete(projectId);
  }
}
async function perform(
  projectId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  const p = requireProject(projectId),
    msg = get("messages", messageId);
  if (!msg || msg.projectId !== projectId || msg.role !== "user")
    throw new Error("仅能导入本项目用户消息中明确提供的资料");
  if (p.archived) throw new Error("项目已归档");
  if (msg.importCompleted && msg.importResults?.every((r: any) => r.materialId))
    return msg.importResults || [];
  const targets = materialImportTargets(msg.content),
    results: any[] = [];
  for (const target of targets) {
    if (signal?.aborted)
      throw new Error("导入已停止，已导入的资料保留，可重试继续");
    try {
      const source =
        target.kind === "local" ? await realpath(target.source) : target.source;
      const existing = projectRows("materials", projectId).find(
        (m) =>
          !m.removed &&
          m.kind === target.kind &&
          (target.kind === "web" ? m.url === source : m.path === source),
      );
      const material =
        existing ||
        (await createMaterial(projectId, {
          kind: target.kind,
          ...(target.kind === "web" ? { url: source } : { path: source }),
          active: false,
          category: "对话导入",
          description: "由用户在项目会话中提供并请求添加。",
        }));
      if (!existing)
        save("materials", {
          ...material,
          importMessageId: messageId,
          importChatId: msg.chatId,
        });
      results.push({
        source: target.source,
        materialId: material.id,
        title: material.title,
        status: material.status,
        error: material.error || null,
        duplicate: !!existing,
      });
    } catch (e: any) {
      results.push({ source: target.source, error: e.message });
    }
    save("messages", { ...get("messages", messageId), importResults: results });
  }
  if (targets.length) {
    save("messages", {
      ...get("messages", messageId),
      importResults: results,
      importCompleted: true,
    });
    syncNextCheck(projectId);
    addActivity(
      projectId,
      "已处理会话资料导入",
      `${results.filter((r) => r.materialId && !r.duplicate).length} 份新增，${results.filter((r) => r.duplicate).length} 份已有，${results.filter((r) => r.error).length} 份存在读取限制。`,
      { messageId, unread: false },
    );
  }
  return results;
}
