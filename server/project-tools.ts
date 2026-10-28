import { randomBytes } from "node:crypto";
import {
  requireMaterial,
  projectRows,
  requireProject,
  addActivity,
} from "./project-store.ts";
import { get, save, transaction } from "./db.ts";
import { captureMaterial, boundFetch, readBoundFile } from "./materials.ts";
const grants = new Map<
  string,
  {
    projectId: string;
    activeOnly: boolean;
    expires: number;
    allowMetadata: boolean;
    taskId?: string;
  }
>();
export function grantProjectTools(
  projectId: string,
  activeOnly: boolean,
  options: { allowMetadata?: boolean; taskId?: string } = {},
) {
  const token = randomBytes(32).toString("hex");
  grants.set(token, {
    projectId,
    activeOnly,
    allowMetadata: !!options.allowMetadata && !activeOnly,
    taskId: options.taskId,
    expires: Date.now() + 15 * 60000,
  });
  return {
    token,
    renew: () => {
      const scope = grants.get(token);
      if (scope) scope.expires = Date.now() + 15 * 60000;
    },
    revoke: () => grants.delete(token),
  };
}
export async function invokeProjectTool(
  token: string,
  name: string,
  args: any,
) {
  const scope = grants.get(token);
  if (!scope || scope.expires < Date.now())
    throw new Error("项目工具授权已失效");
  const { projectId, activeOnly } = scope;
  if (name === "get_project") return requireProject(projectId);
  if (name === "update_project" || name === "update_material") {
    if (!scope.allowMetadata || activeOnly)
      throw new Error("本次任务只能读取项目内容，不能编辑");
    const table = name === "update_project" ? "projects" : "materials";
    const before =
      table === "projects"
        ? requireProject(projectId)
        : requireMaterial(projectId, args.sourceId);
    if (requireProject(projectId).archived) throw new Error("项目已归档");
    if (args.expectedUpdatedAt !== before.updatedAt)
      throw new Error("内容已更新，请重新读取最新版本再编辑，避免覆盖用户修改");
    const allowed =
      table === "projects"
        ? ["name", "goal", "notes", "assistantName"]
        : ["title", "description", "category", "tags"];
    if (
      !args.patch ||
      typeof args.patch !== "object" ||
      Array.isArray(args.patch)
    )
      throw new Error("修改内容无效");
    const patch: any = {};
    for (const [key, value] of Object.entries(args.patch)) {
      if (!allowed.includes(key))
        throw new Error("助手不能直接修改字段：" + key);
      if (key === "tags") {
        if (
          !Array.isArray(value) ||
          value.length > 30 ||
          value.some((x) => typeof x !== "string" || x.length > 100)
        )
          throw new Error("标签无效");
        patch[key] = [...new Set(value.map((x) => x.trim()).filter(Boolean))];
      } else {
        if (
          typeof value !== "string" ||
          value.length >
            (["name", "title", "assistantName", "category"].includes(key)
              ? 300
              : 20000)
        )
          throw new Error("字段文本无效");
        if (["name", "title", "assistantName"].includes(key) && !value.trim())
          throw new Error("名称不能为空");
        patch[key] = value;
      }
    }
    if (!Object.keys(patch).length) throw new Error("没有需要修改的字段");
    return transaction(() => {
      const after = save(table, { ...before, ...patch });
      const audit = addActivity(
        projectId,
        table === "projects" ? "助手已更新项目内容" : "助手已整理资料信息",
        Object.keys(patch)
          .map(
            (k) =>
              (
                ({
                  name: "名称",
                  goal: "目标与描述",
                  notes: "备注",
                  assistantName: "助手名称",
                  title: "资料标题",
                  description: "资料说明",
                  category: "分类",
                  tags: "标签",
                }) as any
              )[k],
          )
          .join("、"),
        {
          kind: "assistant_edit",
          taskId: scope.taskId,
          table,
          entityId: before.id,
          before,
          after,
          fields: Object.keys(patch),
          unread: false,
        },
      );
      return { saved: true, auditId: audit.id, updated: after };
    });
  }
  if (name === "list_sources")
    return projectRows("materials", projectId)
      .filter((m) => !m.removed)
      .map((m) => ({
        id: m.id,
        title: m.title,
        kind: m.kind,
        active: m.active,
        description: m.description,
        status: m.status,
        summary: m.summary,
        url: m.url,
        category: m.category,
        tags: m.tags,
        updatedAt: m.updatedAt,
      }));
  const m = requireMaterial(projectId, args.sourceId);
  if (name === "read_source") {
    if (args.refresh && activeOnly && !m.active)
      throw new Error("定时检查不重新抓取非活跃资料");
    const snapshot = args.refresh
      ? await captureMaterial(m)
      : m.snapshotId
        ? get("materialSnapshots", m.snapshotId)
        : { error: "资料尚无快照" };
    if (!snapshot) return { error: "资料尚无快照" };
    const { raw, imagePath, ...safe } = snapshot;
    return { ...safe, imageAvailable: !!imagePath };
  }
  if (activeOnly && !m.active) throw new Error("定时检查只能追加读取活跃资料");
  if (name === "read_web_link") {
    if (m.kind !== "web") throw new Error("该资料不是网页");
    const b = await boundFetch(m, args.url);
    return {
      text: b.toString().slice(0, 180000),
      url: args.url,
      truncated: b.length > 180000,
    };
  }
  if (name === "read_local_file")
    return readBoundFile(projectId, m.id, args.relativePath);
  throw new Error("不支持的只读工具");
}

export function undoAssistantEdit(projectId: string, auditId: string) {
  const audit = get("projectActivities", auditId);
  if (
    !audit ||
    audit.projectId !== projectId ||
    audit.kind !== "assistant_edit" ||
    audit.undoneAt
  )
    throw new Error("可撤销的编辑记录不存在");
  const table = audit.table as "projects" | "materials";
  if (!["projects", "materials"].includes(table))
    throw new Error("编辑记录无效");
  const current = get(table, audit.entityId);
  if (
    !current ||
    current.updatedAt !== audit.after.updatedAt ||
    audit.fields.some(
      (k: string) =>
        JSON.stringify(current[k]) !== JSON.stringify(audit.after[k]),
    )
  )
    throw new Error("内容已有后续修改，请手动调整，避免覆盖新内容");
  const patch = Object.fromEntries(
    audit.fields.map((k: string) => [k, audit.before[k]]),
  );
  const restored = save(table, { ...current, ...patch });
  save("projectActivities", { ...audit, undoneAt: new Date().toISOString() });
  addActivity(projectId, "已撤销助手编辑", audit.detail, {
    unread: false,
    editId: auditId,
  });
  return restored;
}
