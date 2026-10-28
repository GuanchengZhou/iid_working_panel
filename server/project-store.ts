import { all, get, save, transaction } from "./db.ts";
export function requireProject(id: string) {
  const p = get("projects", id);
  if (!p) throw new Error("项目不存在");
  return p;
}
export function requireMaterial(projectId: string, id: string) {
  const m = get("materials", id);
  if (!m || m.projectId !== projectId || m.removed)
    throw new Error("资料不存在或不属于当前项目");
  return m;
}
export function projectRows(
  table: Parameters<typeof all>[0],
  projectId: string,
) {
  return all(table).filter((x) => x.projectId === projectId);
}
export function addActivity(
  projectId: string,
  title: string,
  detail: string,
  extra: any = {},
) {
  return save("projectActivities", {
    projectId,
    title,
    detail,
    unread: true,
    ...extra,
  });
}
export function hasActive(projectId: string) {
  return projectRows("materials", projectId).some(
    (m) => m.active && !m.removed,
  );
}
export function syncNextCheck(projectId: string, now = Date.now()) {
  const p = requireProject(projectId);
  const next =
    p.autoFollowEnabled && !p.archived && hasActive(projectId)
      ? p.nextCheckAt || new Date(now + 3600000).toISOString()
      : null;
  return save("projects", { ...p, nextCheckAt: next });
}
export function dueProjects(
  projects: any[],
  materials: any[],
  tasks: any[],
  now: number,
) {
  return projects
    .filter(
      (p) =>
        p.autoFollowEnabled &&
        !p.archived &&
        p.nextCheckAt &&
        Date.parse(p.nextCheckAt) <= now &&
        materials.some((m) => m.projectId === p.id && m.active && !m.removed) &&
        !tasks.some(
          (t) =>
            t.projectId === p.id &&
            t.type === "project_check" &&
            ["queued", "running"].includes(t.status),
        ),
    )
    .sort(
      (a, b) =>
        a.priority - b.priority || a.nextCheckAt.localeCompare(b.nextCheckAt),
    );
}
export function taskOrder(a: any, b: any) {
  const rank = (t: any) =>
    (["chat", "project_chat"].includes(t.type) || (t.type === "review_step" && t.step === "chat"))
      ? 0
      : !t.scheduled
        ? 1
        : 2 + (get("projects", t.projectId)?.priority ?? 3);
  return rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt);
}
export function acceptSuggestion(projectId: string, id: string) {
  return transaction(() => {
    const s = get("projectSuggestions", id);
    if (!s || s.projectId !== projectId || s.status !== "pending")
      throw new Error("建议不存在或已处理");
    let todo: any;
    if (s.action === "create") {
      todo = save("projectTodos", {
        projectId,
        title: s.title,
        description: s.description || "",
        priority: s.priority ?? 2,
        dueDate: s.dueDate || "",
        status: s.proposedStatus || "todo",
        origin: "assistant",
        suggestionId: id,
        evidence: s.evidence || [],
        completedAt:
          s.proposedStatus === "done" ? new Date().toISOString() : null,
      });
    } else {
      todo = get("projectTodos", s.todoId);
      if (!todo || todo.projectId !== projectId)
        throw new Error("关联事项不存在");
      save("projectSuggestions", { ...s, previousTodo: todo });
      todo = save("projectTodos", {
        ...todo,
        ...s.patch,
        completedAt:
          s.patch?.status === "done" ? new Date().toISOString() : null,
      });
    }
    save("projectSuggestions", {
      ...get("projectSuggestions", id),
      status: "accepted",
      todoId: todo.id,
      acceptedAt: new Date().toISOString(),
      appliedTodoUpdatedAt: todo.updatedAt,
      appliedTodo: todo,
    });
    addActivity(projectId, "已采纳事项建议", s.title, {
      unread: false,
      suggestionId: id,
    });
    return todo;
  });
}
export function undoSuggestion(projectId: string, id: string) {
  return transaction(() => {
    const s = get("projectSuggestions", id);
    if (!s || s.projectId !== projectId || s.status !== "accepted")
      throw new Error("该建议不能撤销");
    const todo = get("projectTodos", s.todoId);
    if (
      !todo ||
      (s.appliedTodo
        ? JSON.stringify(todo) !== JSON.stringify(s.appliedTodo)
        : todo.updatedAt !== s.appliedTodoUpdatedAt)
    )
      throw new Error("事项已被再次修改，请手动调整以免覆盖新内容");
    if (s.action === "create") save("projectTodos", { ...todo, removed: true });
    else save("projectTodos", s.previousTodo);
    return save("projectSuggestions", { ...s, status: "undone" });
  });
}
