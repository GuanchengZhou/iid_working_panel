import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  ArrowLeft,
  Sparkles,
  FolderKanban,
  FileText,
  CheckCircle2,
  Clock,
  RefreshCw,
  X,
  ArrowUpRight,
  Settings,
  Square,
  Send,
  Bell,
  Archive,
  ChevronRight,
} from "lucide-react";
import { api } from "./types";
import Markdown from "./Markdown";
import AssistantControls from "./AssistantControls";
import "./projects.css";
const date = (v?: string) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const statusNames: any = {
  todo: "待办",
  doing: "进行中",
  blocked: "阻塞",
  done: "已完成",
  active: "进行中",
  paused: "暂停",
  completed: "已完成",
  on_track: "进展正常",
  attention: "需要关注",
  unknown: "待检查",
  ready: "已采集",
  needs_auth: "需要登录 / 权限",
  error: "读取失败",
  partial: "部分采集",
  unsupported: "解析受限",
  queued: "排队中",
  running: "执行中",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
function Modal({ title, close, children }: any) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="modal project-modal">
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" title="关闭" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({ label, children }: any) {
  return (
    <label className="project-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Priority({ value, onChange }: any) {
  return (
    <select
      aria-label="优先级"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {[0, 1, 2, 3].map((p) => (
        <option key={p} value={p}>
          P{p} {["最高", "高", "普通", "低"][p]}
        </option>
      ))}
    </select>
  );
}
export default function ProjectsWorkspace({
  onError,
}: {
  onError: (s: string) => void;
}) {
  const [projects, setProjects] = useState<any[]>([]),
    [selected, setSelected] = useState(
      localStorage.getItem("iid-project") || "",
    ),
    [data, setData] = useState<any>(null),
    [tab, setTab] = useState("overview"),
    [archived, setArchived] = useState(false),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState<any>(null),
    [chatOpen, setChatOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [snapshots, setSnapshots] = useState<any[]>([]),
    [snapshotIndex, setSnapshotIndex] = useState(0),
    [reportId, setReportId] = useState("");
  useEffect(() => {
    const f = (e: Event) => setSelected((e as CustomEvent).detail);
    window.addEventListener("iid-open-project", f);
    return () => window.removeEventListener("iid-open-project", f);
  }, []);
  const load = useCallback(async () => {
    const list = await api<any[]>("/projects");
    setProjects(list);
    if (selected) setData(await api(`/projects/${selected}`));
    else setData(null);
  }, [selected]);
  useEffect(() => {
    void load().catch((e) => onError(e.message));
    const es = new EventSource("/api/events");
    let t: ReturnType<typeof setTimeout>;
    es.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => void load().catch((e) => onError(e.message)), 200);
    };
    return () => {
      es.close();
      clearTimeout(t);
    };
  }, [load, onError]);
  useEffect(() => {
    localStorage.setItem("iid-project", selected);
    setReportId("");
    setTab("overview");
  }, [selected]);
  useEffect(() => {
    const listener = () => setChatOpen((v) => !v);
    window.addEventListener("iid-project-ai", listener);
    return () => window.removeEventListener("iid-project-ai", listener);
  }, []);
  async function act(url: string, body?: any, method = "POST") {
    try {
      const r = await api(url, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await load();
      return r;
    } catch (e: any) {
      onError(e.message);
      throw e;
    }
  }
  const p = data?.project?.id === selected ? data.project : null;
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: any) => act(`/projects/${selected}`, body, "PATCH");
  const openSource = async (id: string, snapshotId?: string) => {
    try {
      const source = data?.materials.find((m: any) => m.id === id);
      if (!source) return;
      const values = await api<any[]>(
        `/projects/${selected}/materials/${id}/snapshots`,
      );
      setSnapshots(values);
      setSnapshotIndex(
        Math.max(
          0,
          values.findIndex((s) => s.id === snapshotId),
        ),
      );
      setModal({ type: "snapshot", value: source });
    } catch (e: any) {
      onError(e.message);
    }
  };
  const check = data?.tasks.find(
    (t: any) =>
      t.type === "project_check" && ["queued", "running"].includes(t.status),
  );
  const reports = data?.reports || [],
    report = reports.find((r: any) => r.id === reportId) || reports[0];
  const pending = data?.todos.filter((t: any) => t.status !== "done") || [],
    done = data?.todos.filter((t: any) => t.status === "done") || [];
  const suggestions =
    data?.suggestions.filter((s: any) => s.status === "pending") || [];
  const sourceEvidence = (evidence: any[]) =>
    evidence?.map((e: any, i: number) => (
      <button
        className="project-evidence"
        key={i}
        title={e.detail}
        onClick={() => void openSource(e.sourceId, e.snapshotId)}
      >
        {e.verified ? "↗" : "?"}{" "}
        {data?.materials.find((m: any) => m.id === e.sourceId)?.title ||
          "来源待核查"}
      </button>
    ));
  return (
    <div className="project-shell">
      <div className="project-content">
        {!selected ? (
          <>
            <div className="project-heading">
              <div>
                <span className="eyebrow">MOVE RESEARCH FORWARD</span>
                <h1>
                  项目跟进<span className="project-heading-dot">.</span>
                </h1>
                <p>把资料、判断与下一步，放回同一个项目。</p>
              </div>
              <button
                className="primary"
                onClick={() =>
                  setModal({
                    type: "project",
                    value: { name: "", goal: "", notes: "", priority: 1 },
                  })
                }
              >
                <Plus size={17} />
                新建项目
              </button>
            </div>
            <div className="project-stats">
              {[
                [
                  "进行中的项目",
                  projects.filter((p) => !p.archived && p.status === "active")
                    .length,
                ],
                [
                  "待完成事项",
                  projects
                    .filter((p) => !p.archived)
                    .reduce((n, p) => n + p.pendingCount, 0),
                ],
                ["未读动态", projects.reduce((n, p) => n + p.unreadCount, 0)],
                [
                  "自动跟进中",
                  projects.filter((p) => p.autoFollowEnabled && !p.archived)
                    .length,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="project-toolbar">
              <input
                aria-label="搜索项目"
                placeholder="搜索项目、目标或当前情况…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />
                显示已归档
              </label>
              <span>按优先级排序</span>
            </div>
            <div className="project-grid">
              {projects
                .filter(
                  (p) =>
                    (archived || !p.archived) &&
                    [p.name, p.goal, p.headline]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .sort((a, b) => a.priority - b.priority)
                .map((p) => (
                  <button
                    className="project-card"
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <div className="project-card-top">
                      <span className={`priority p${p.priority}`}>
                        P{p.priority}
                      </span>
                      <span className={`project-health ${p.health}`}>
                        {p.archived
                          ? "已归档"
                          : statusNames[p.health] || "待检查"}
                      </span>
                      {p.unreadCount > 0 && (
                        <span className="project-unread">
                          {p.unreadCount} 条新动态
                        </span>
                      )}
                      <ArrowUpRight size={17} />
                    </div>
                    <h2>{p.name}</h2>
                    <p className="project-goal">
                      {p.goal || "还没有填写项目目标"}
                    </p>
                    <div className="project-current">
                      <small>当前情况</small>
                      <p>
                        {p.headline ||
                          "添加资料，点击「立即检查」生成第一份进度报告。"}
                      </p>
                      {p.aiStage && <span>{p.aiStage}</span>}
                    </div>
                    {p.blockers?.length > 0 && (
                      <div className="project-card-blocker">
                        关注 · {p.blockers[0]}
                      </div>
                    )}
                    {p.pendingItems?.slice(0, 3).map((t: any) => (
                      <div className="project-card-todo" key={t.id}>
                        <span className={`priority p${t.priority}`}>
                          P{t.priority}
                        </span>
                        {t.title}
                        <small>{statusNames[t.status]}</small>
                      </div>
                    ))}
                    <div className="project-card-bottom">
                      <span>
                        <CheckCircle2 size={14} />
                        {p.pendingCount} 待完成 · {p.doneCount} 已完成
                      </span>
                      <span>
                        <Clock size={14} />
                        {p.autoFollowEnabled ? "每小时跟进" : "手动跟进"}
                      </span>
                    </div>
                    {p.suggestionCount > 0 && (
                      <div className="project-suggestion-hint">
                        {p.suggestionCount} 条助手建议待确认{" "}
                        <ChevronRight size={13} />
                      </div>
                    )}
                  </button>
                ))}
            </div>
            {!projects.length && (
              <div className="project-empty">
                <FolderKanban size={40} />
                <h2>研究的下一步，从这里开始</h2>
                <p>创建项目后，为它绑定资料和专属助手。</p>
              </div>
            )}
          </>
        ) : p ? (
          <>
            <div className="project-heading single">
              <div>
                <button
                  className="project-back"
                  onClick={() => {
                    setSelected("");
                    setChatOpen(false);
                  }}
                >
                  <ArrowLeft size={15} />
                  所有项目
                </button>
                <div className="project-title-row">
                  <span className={`priority p${p.priority}`}>
                    P{p.priority}
                  </span>
                  <h1>{p.name}</h1>
                  <span className={`project-health ${p.health}`}>
                    {p.archived ? "已归档" : statusNames[p.health]}
                  </span>
                </div>
                <p>{p.goal || "填写目标，让每次推进都有方向。"}</p>
              </div>
              <div className="project-heading-actions">
                <button
                  className="secondary"
                  onClick={() => setModal({ type: "project", value: { ...p } })}
                >
                  <Settings size={15} />
                  编辑项目
                </button>
                <button
                  className="primary"
                  disabled={!!check || p.archived}
                  onClick={() => void run(() => act(`/projects/${p.id}/check`))}
                >
                  <RefreshCw size={16} className={check ? "spin" : ""} />
                  {check ? "检查中" : "立即检查"}
                </button>
              </div>
            </div>
            <div className="project-follow">
              <div>
                <strong>自动跟进</strong>
                <span>每小时 · 仅在后端运行时检查活跃资料</span>
              </div>
              <button
                role="switch"
                aria-checked={!!p.autoFollowEnabled}
                aria-label="自动跟进"
                className={`project-switch ${p.autoFollowEnabled ? "on" : ""}`}
                disabled={p.archived}
                onClick={() =>
                  void run(() =>
                    patch({ autoFollowEnabled: !p.autoFollowEnabled }),
                  )
                }
              >
                <i />
              </button>
              <div className="project-follow-times">
                <span>最近检查 {date(p.lastCheckedAt)}</span>
                <span>
                  下次{" "}
                  {p.autoFollowEnabled
                    ? p.nextCheckAt
                      ? date(p.nextCheckAt)
                      : "等待活跃资料"
                    : "未开启"}
                </span>
              </div>
              {check && (
                <button
                  className="project-link"
                  onClick={() =>
                    void run(() => act(`/tasks/${check.id}/cancel`))
                  }
                >
                  <Square size={12} />
                  停止本次
                </button>
              )}
            </div>
            {p.autoFollowEnabled &&
              !data.materials.some((m: any) => m.active) && (
                <p className="project-warning">
                  尚无活跃资料。请在项目资料中设置，自动检查将在设置后开始。
                </p>
              )}
            {check && (
              <div className="project-running">
                <Sparkles size={15} />
                {check.stage || statusNames[check.status]}
                <span>当前任务：{statusNames[check.status]}</span>
              </div>
            )}
            {p.lastCheckError && (
              <div className="project-warning">
                最近检查未完成：{p.lastCheckError}{" "}
                <button
                  onClick={() => void run(() => act(`/projects/${p.id}/check`))}
                >
                  重试检查
                </button>
              </div>
            )}
            <nav className="project-tabs">
              {[
                ["overview", "项目总览"],
                ["materials", "项目资料"],
                ["todos", "待完成事项"],
                ["done", "已完成事项"],
                ["activity", "助手动态"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "active" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                  <small>
                    {key === "materials"
                      ? data.materials.length
                      : key === "todos"
                        ? pending.length
                        : key === "done"
                          ? done.length
                          : key === "activity"
                            ? data.activities.filter((a: any) => a.unread)
                                .length
                            : ""}
                  </small>
                </button>
              ))}
              <button
                className="project-assistant-button"
                onClick={() => setChatOpen((v) => !v)}
              >
                <Sparkles size={15} />
                项目助手
              </button>
            </nav>
            {tab === "overview" && (
              <div className="project-overview">
                <section className="project-panel project-report">
                  <div className="project-section-heading">
                    <div>
                      <span className="eyebrow">PROJECT PULSE</span>
                      <h2>现在进行到哪了</h2>
                    </div>
                    {reports.length > 0 && (
                      <select
                        aria-label="报告历史"
                        value={report?.id || ""}
                        onChange={(e) => setReportId(e.target.value)}
                      >
                        {reports.map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {date(r.createdAt)} ·{" "}
                            {r.scheduled ? "自动" : "手动"}检查
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {report ? (
                    <>
                      <div className="project-report-headline">
                        {report.headline}
                      </div>
                      <div className="project-report-meta">
                        {date(report.createdAt)} · {report.model} ·{" "}
                        {report.stage}
                      </div>
                      <Markdown
                        text={report.markdown}
                        onMaterial={(id) =>
                          void openSource(
                            id,
                            report?.evidence?.find(
                              (e: any) => e.sourceId === id,
                            )?.snapshotId,
                          )
                        }
                      />
                      <div className="project-evidence-row">
                        {sourceEvidence(report.evidence)}
                      </div>
                      {report.collectionErrors?.length > 0 && (
                        <div className="project-warning">
                          采集限制：{report.collectionErrors.join("；")}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="project-empty">
                      <Sparkles size={30} />
                      <p>助手将结合资料，梳理当前阶段、卡点和下一步。</p>
                      <button
                        className="secondary"
                        disabled={!!check || p.archived}
                        onClick={() =>
                          void run(() => act(`/projects/${p.id}/check`))
                        }
                      >
                        生成首份报告
                      </button>
                    </div>
                  )}
                </section>
                <aside className="project-overview-side">
                  <section className="project-panel">
                    <h3>用户备注</h3>
                    <p className="project-user-notes">
                      {p.notes || "在编辑项目中记录你的判断与约束。"}
                    </p>
                    <small>由你维护，AI 报告单独保存。</small>
                  </section>
                  <section className="project-panel">
                    <h3>当前卡点</h3>
                    {report?.blockers?.length ? (
                      report.blockers.map((b: string, i: number) => (
                        <p className="project-bullet" key={i}>
                          {b}
                        </p>
                      ))
                    ) : (
                      <p className="muted">
                        {report ? "暂未发现明确卡点" : "等待资料检查"}
                      </p>
                    )}
                  </section>
                  <section className="project-panel">
                    <h3>接下来</h3>
                    {report?.nextSteps?.map((b: string, i: number) => (
                      <p className="project-bullet" key={i}>
                        {b}
                      </p>
                    ))}
                    {pending.slice(0, 5).map((t: any) => (
                      <button
                        className="project-next-item"
                        key={t.id}
                        onClick={() => setTab("todos")}
                      >
                        <span className={`priority p${t.priority}`}>
                          P{t.priority}
                        </span>
                        {t.title}
                      </button>
                    ))}
                    {!pending.length && !report && (
                      <p className="muted">尚无正式待办</p>
                    )}
                  </section>
                </aside>
              </div>
            )}
            {tab === "materials" && (
              <>
                <div className="project-section-heading">
                  <div>
                    <h2>项目资料</h2>
                    <p>
                      原件保持不变；活跃资料参与定时检查，其他资料作为背景。
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() =>
                      setModal({
                        type: "material",
                        value: {
                          kind: "local",
                          title: "",
                          description: "",
                          category: "参考资料",
                          tags: [],
                          active: false,
                        },
                      })
                    }
                  >
                    <Plus size={16} />
                    添加资料
                  </button>
                </div>
                <div className="project-materials">
                  {data.materials.map((m: any) => (
                    <article className="project-panel material-card" key={m.id}>
                      <div className="project-section-heading">
                        <div>
                          <small>
                            {
                              (
                                {
                                  codex: "Codex 会话",
                                  local: "本地引用",
                                  upload: "附件",
                                  web: "网页",
                                  text: "背景文本",
                                  inspire: "Inspire",
                                } as any
                              )[m.kind]
                            }{" "}
                            · {m.category}
                          </small>
                          <h3>
                            <FileText size={17} />
                            {m.title}
                          </h3>
                        </div>
                        <label className="material-active">
                          <input
                            type="checkbox"
                            checked={m.active}
                            onChange={(e) =>
                              void run(() =>
                                act(
                                  `/projects/${p.id}/materials/${m.id}`,
                                  { active: e.target.checked },
                                  "PATCH",
                                ),
                              )
                            }
                          />
                          活跃
                        </label>
                      </div>
                      <p className="material-description">{m.description}</p>
                      <p>
                        {m.summary ||
                          (m.status === "needs_auth"
                            ? "已保存资料链接，取得正文后才能整理摘要。"
                            : "尚无 AI 摘要，检查项目后自动整理。")}
                      </p>
                      <div className="material-source">
                        {m.url ||
                          m.path ||
                          m.remotePath ||
                          m.resourceName ||
                          m.sourceUrl ||
                          "本地保存的背景文本"}
                      </div>
                      <div className="material-tags">
                        {m.tags.map((t: string) => (
                          <span key={t}>#{t}</span>
                        ))}
                      </div>
                      {m.error && (
                        <p className="project-warning">
                          {m.error}
                          {m.snapshotId && " 保留最后有效快照。"}
                        </p>
                      )}
                      <footer>
                        <span>
                          {statusNames[m.status] || m.status} ·{" "}
                          {date(m.lastCheckedAt)}
                        </span>
                        <button onClick={() => void openSource(m.id)}>
                          查看快照
                        </button>
                        <button
                          onClick={() =>
                            void run(() =>
                              act(
                                `/projects/${p.id}/materials/${m.id}/refresh`,
                              ),
                            )
                          }
                        >
                          重新采集
                        </button>
                        <button
                          onClick={() =>
                            setModal({ type: "material", value: { ...m } })
                          }
                        >
                          编辑
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
                {!data.materials.length && (
                  <div className="project-empty">
                    <FileText size={35} />
                    <p>绑定本地文件、网页或实验结果，让助手有据可查。</p>
                  </div>
                )}
              </>
            )}
            {(tab === "todos" || tab === "done") && (
              <>
                <div className="project-section-heading">
                  <div>
                    <h2>{tab === "todos" ? "待完成事项" : "已完成事项"}</h2>
                    <p>你维护正式事项；助手提出的修改需要先确认。</p>
                  </div>
                  <button
                    className="primary"
                    onClick={() =>
                      setModal({
                        type: "todo",
                        value: {
                          title: "",
                          description: "",
                          priority: 2,
                          status: "todo",
                          dueDate: "",
                        },
                      })
                    }
                  >
                    <Plus size={16} />
                    添加事项
                  </button>
                </div>
                <div className="project-todos">
                  {(tab === "done" ? done : pending)
                    .sort((a: any, b: any) => a.priority - b.priority)
                    .map((t: any) => (
                      <article
                        className="project-panel project-todo"
                        key={t.id}
                      >
                        <button
                          className={`todo-check ${t.status === "done" ? "checked" : ""}`}
                          title={t.status === "done" ? "重新打开" : "标记完成"}
                          onClick={() =>
                            void run(() =>
                              act(
                                `/projects/${p.id}/todos/${t.id}`,
                                {
                                  status: t.status === "done" ? "todo" : "done",
                                },
                                "PATCH",
                              ),
                            )
                          }
                        >
                          <CheckCircle2 size={20} />
                        </button>
                        <div>
                          <h3>{t.title}</h3>
                          <p>{t.description}</p>
                          <div className="project-evidence-row">
                            {sourceEvidence(t.evidence)}
                          </div>
                          <small>
                            {t.dueDate ? "截止 " + t.dueDate + " · " : ""}
                            {t.origin === "assistant"
                              ? "来自已确认的助手建议"
                              : "用户创建"}
                          </small>
                        </div>
                        <span className={`priority p${t.priority}`}>
                          P{t.priority}
                        </span>
                        <select
                          aria-label={`事项状态 ${t.title}`}
                          value={t.status}
                          onChange={(e) =>
                            void run(() =>
                              act(
                                `/projects/${p.id}/todos/${t.id}`,
                                { status: e.target.value },
                                "PATCH",
                              ),
                            )
                          }
                        >
                          {["todo", "doing", "blocked", "done"].map((s) => (
                            <option key={s} value={s}>
                              {statusNames[s]}
                            </option>
                          ))}
                        </select>
                        <button
                          className="project-link"
                          onClick={() =>
                            setModal({ type: "todo", value: { ...t } })
                          }
                        >
                          编辑
                        </button>
                      </article>
                    ))}
                </div>
                {!(tab === "done" ? done : pending).length && (
                  <div className="project-empty">
                    <CheckCircle2 size={32} />
                    <p>
                      {tab === "done"
                        ? "已完成的工作将在这里归档。"
                        : "还没有待完成事项。可以添加，或确认下方的助手建议。"}
                    </p>
                  </div>
                )}
              </>
            )}
            {(tab === "overview" || tab === "todos" || tab === "done") &&
              suggestions.length > 0 && (
                <section className="project-panel project-suggestions">
                  <div className="project-section-heading">
                    <div>
                      <span className="eyebrow">YOUR DECISION</span>
                      <h2>
                        助手建议 <small>{suggestions.length} 待确认</small>
                      </h2>
                    </div>
                    <span>确认前不会改动正式事项</span>
                  </div>
                  {suggestions.map((s: any) => (
                    <div className="project-suggestion" key={s.id}>
                      <div>
                        <small>
                          {s.action === "create" ? "新增事项" : "修改事项"} ·{" "}
                          {statusNames[s.proposedStatus]} · P{s.priority}
                        </small>
                        <h3>{s.title}</h3>
                        <p>{s.description}</p>
                        <div className="project-evidence-row">
                          {sourceEvidence(s.evidence)}
                        </div>
                      </div>
                      <div>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              act(`/projects/${p.id}/suggestions/${s.id}`, {
                                action: "reject",
                              }),
                            )
                          }
                        >
                          不采纳
                        </button>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              act(`/projects/${p.id}/suggestions/${s.id}`, {
                                action: "accept",
                              }),
                            )
                          }
                        >
                          确认{s.action === "create" ? "添加" : "修改"}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            {tab === "activity" && (
              <>
                <div className="project-section-heading">
                  <div>
                    <h2>助手动态与检查记录</h2>
                    <p>只有进展、异常或需要你处理的变化会产生未读提醒。</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run(() => act(`/projects/${p.id}/read`))
                    }
                  >
                    <Bell size={15} />
                    全部标为已读
                  </button>
                </div>
                <section className="project-panel">
                  {data.activities.map((a: any) => (
                    <div className="project-activity" key={a.id}>
                      <span
                        className={`activity-dot ${a.unread ? "unread" : ""}`}
                      />
                      <div>
                        <strong>{a.title}</strong>
                        <p>{a.detail}</p>
                        {a.kind === "assistant_edit" && (
                          <>
                            <details>
                              <summary>查看修改前后</summary>
                              {a.fields.map((k: string) => (
                                <div className="assistant-edit-note" key={k}>
                                  <strong>
                                    {
                                      (
                                        {
                                          name: "名称",
                                          goal: "目标与描述",
                                          notes: "备注",
                                          assistantName: "助手名称",
                                          title: "资料标题",
                                          description: "资料说明",
                                          category: "分类",
                                          tags: "标签",
                                        } as any
                                      )[k]
                                    }
                                  </strong>
                                  <p>
                                    修改前：
                                    {Array.isArray(a.before[k])
                                      ? a.before[k].join("，")
                                      : a.before[k] || "（空）"}
                                  </p>
                                  <p>
                                    修改后：
                                    {Array.isArray(a.after[k])
                                      ? a.after[k].join("，")
                                      : a.after[k] || "（空）"}
                                  </p>
                                </div>
                              ))}
                            </details>
                            {a.undoneAt ? (
                              <small>已撤销</small>
                            ) : (
                              <button
                                onClick={() =>
                                  void run(() =>
                                    act(`/projects/${p.id}/edits/${a.id}/undo`),
                                  )
                                }
                              >
                                撤销本次修改
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <small>{date(a.createdAt)}</small>
                    </div>
                  ))}
                  {!data.activities.length && <p className="muted">暂无动态</p>}
                </section>
                <h3 className="project-subheading">检查历史</h3>
                <section className="project-panel">
                  {data.tasks
                    .filter((t: any) => t.type === "project_check")
                    .map((t: any) => (
                      <div className="project-activity" key={t.id}>
                        <Clock size={16} />
                        <div>
                          <strong>
                            {t.scheduled ? "定时" : "手动"}检查 ·{" "}
                            {statusNames[t.status] || t.status}
                          </strong>
                          <p>{t.error || t.stage}</p>
                        </div>
                        <small>{date(t.createdAt)}</small>
                        {["failed", "interrupted", "cancelled"].includes(
                          t.status,
                        ) && (
                          <button
                            onClick={() =>
                              void run(() => act(`/tasks/${t.id}/retry`))
                            }
                          >
                            重试
                          </button>
                        )}
                      </div>
                    ))}
                </section>
                <h3 className="project-subheading">建议操作记录</h3>
                <section className="project-panel">
                  {data.suggestions
                    .filter((s: any) => s.status !== "pending")
                    .map((s: any) => (
                      <div className="project-activity" key={s.id}>
                        <CheckCircle2 size={16} />
                        <div>
                          <strong>{s.title}</strong>
                          <p>
                            {
                              (
                                {
                                  accepted: "已确认",
                                  rejected: "未采纳",
                                  undone: "已撤销",
                                } as any
                              )[s.status]
                            }{" "}
                            · {date(s.updatedAt)}
                          </p>
                        </div>
                        {s.status === "accepted" && (
                          <button
                            onClick={() =>
                              void run(() =>
                                act(`/projects/${p.id}/suggestions/${s.id}`, {
                                  action: "undo",
                                }),
                              )
                            }
                          >
                            撤销操作
                          </button>
                        )}
                      </div>
                    ))}
                </section>
              </>
            )}
          </>
        ) : (
          <div className="project-empty">
            正在加载项目…
            <button onClick={() => setSelected("")}>返回所有项目</button>
          </div>
        )}
      </div>
      {selected && p && chatOpen && (
        <ProjectChat
          project={p}
          chats={data.chats}
          tasks={data.tasks}
          refresh={load}
          close={() => setChatOpen(false)}
          onError={onError}
          onMaterial={openSource}
        />
      )}
      {!selected && chatOpen && (
        <Modal title="专属项目助手" close={() => setChatOpen(false)}>
          <p>请先打开一个项目，每个项目的资料与会话独立保存。</p>
        </Modal>
      )}
      {modal?.type === "project" && (
        <Modal
          title={modal.value.id ? "编辑项目" : "新建项目"}
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const v = modal.value;
                const r = await act(
                  v.id ? `/projects/${v.id}` : "/projects",
                  v,
                  v.id ? "PATCH" : "POST",
                );
                setModal(null);
                setSelected(r.id);
              });
            }}
          >
            <Field label="项目名称">
              <input
                required
                value={modal.value.name}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    value: { ...modal.value, name: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="项目目标">
              <textarea
                rows={3}
                value={modal.value.goal}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    value: { ...modal.value, goal: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="用户备注">
              <textarea
                rows={4}
                value={modal.value.notes}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    value: { ...modal.value, notes: e.target.value },
                  })
                }
              />
            </Field>
            <div className="project-form-row">
              <Field label="优先级">
                <Priority
                  value={modal.value.priority}
                  onChange={(priority: number) =>
                    setModal({ ...modal, value: { ...modal.value, priority } })
                  }
                />
              </Field>
              {modal.value.id && (
                <Field label="项目状态">
                  <select
                    value={modal.value.status}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        value: { ...modal.value, status: e.target.value },
                      })
                    }
                  >
                    {["active", "paused", "completed"].map((s) => (
                      <option value={s} key={s}>
                        {statusNames[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <footer className="project-modal-footer">
              {modal.value.id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void run(async () => {
                      await patch({ archived: !modal.value.archived });
                      setModal(null);
                    })
                  }
                >
                  <Archive size={15} />
                  {modal.value.archived ? "恢复项目" : "归档项目"}
                </button>
              )}
              <button className="primary" disabled={busy}>
                保存项目
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {modal?.type === "todo" && (
        <Modal
          title={modal.value.id ? "编辑事项" : "添加事项"}
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const v = modal.value;
                await act(
                  `/projects/${selected}/todos${v.id ? "/" + v.id : ""}`,
                  v,
                  v.id ? "PATCH" : "POST",
                );
                setModal(null);
              });
            }}
          >
            <Field label="事项标题">
              <input
                required
                value={modal.value.title}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    value: { ...modal.value, title: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="描述">
              <textarea
                rows={4}
                value={modal.value.description}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    value: { ...modal.value, description: e.target.value },
                  })
                }
              />
            </Field>
            <div className="project-form-row">
              <Field label="优先级">
                <Priority
                  value={modal.value.priority}
                  onChange={(priority: number) =>
                    setModal({ ...modal, value: { ...modal.value, priority } })
                  }
                />
              </Field>
              <Field label="状态">
                <select
                  value={modal.value.status}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      value: { ...modal.value, status: e.target.value },
                    })
                  }
                >
                  {["todo", "doing", "blocked", "done"].map((s) => (
                    <option key={s} value={s}>
                      {statusNames[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="截止日期（可选）">
                <input
                  type="date"
                  value={modal.value.dueDate || ""}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      value: { ...modal.value, dueDate: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
            <footer className="project-modal-footer">
              {modal.value.id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void run(async () => {
                      await act(
                        `/projects/${selected}/todos/${modal.value.id}`,
                        { removed: true },
                        "PATCH",
                      );
                      setModal(null);
                    })
                  }
                >
                  移除事项
                </button>
              )}
              <button className="primary" disabled={busy}>
                保存事项
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {modal?.type === "material" && (
        <MaterialForm
          value={modal.value}
          close={() => setModal(null)}
          busy={busy}
          run={run}
          save={async (v: any, files?: FileList) => {
            if (files) {
              const f = new FormData();
              Array.from(files).forEach((file) => f.append("files", file));
              const results = await api<any[]>(
                `/projects/${selected}/uploads`,
                { method: "POST", body: f },
              );
              const errors = results.filter((r) => r.error);
              if (errors.length)
                onError(
                  errors.map((r) => r.filename + "：" + r.error).join("；"),
                );
            } else
              await act(
                `/projects/${selected}/materials${v.id ? "/" + v.id : ""}`,
                v,
                v.id ? "PATCH" : "POST",
              );
            await load();
            setModal(null);
          }}
        />
      )}
      {modal?.type === "snapshot" && (
        <Modal title={modal.value.title} close={() => setModal(null)}>
          <div className="project-snapshot-header">
            <select
              aria-label="资料版本"
              value={snapshotIndex}
              onChange={(e) => setSnapshotIndex(Number(e.target.value))}
            >
              {snapshots.map((s, i) => (
                <option key={s.id} value={i}>
                  {date(s.fetchedAt)} · {s.hash.slice(0, 8)}
                </option>
              ))}
            </select>
            {["local", "upload"].includes(modal.value.kind) &&
              !modal.value.isDirectory && (
                <a
                  href={`/api/projects/${selected}/materials/${modal.value.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开原件 ↗
                </a>
              )}
            {modal.value.url && (
              <a href={modal.value.url} target="_blank" rel="noreferrer">
                打开网页 ↗
              </a>
            )}
          </div>
          {snapshots[snapshotIndex]?.imagePath && (
            <img
              alt="资料图片快照"
              className="project-source-image"
              src={`/api/projects/${selected}/materials/${modal.value.id}/file?snapshotId=${snapshots[snapshotIndex].id}`}
            />
          )}
          <pre className="project-snapshot-text">
            {snapshots[snapshotIndex]?.text ||
              "尚无可读取的快照。" + (modal.value.error || "")}
          </pre>
          {snapshots[snapshotIndex]?.truncated && (
            <p className="project-warning">
              内容超过读取上限，当前显示截取的部分。
            </p>
          )}
          <small>
            快照 ID：{snapshots[snapshotIndex]?.id || "—"} · 原件保持不变
          </small>
        </Modal>
      )}
    </div>
  );
}
function MaterialForm({ value, close, busy, run, save }: any) {
  const [v, setV] = useState(value),
    [files, setFiles] = useState<FileList | null>(null);
  const change = (key: string, val: any) => setV({ ...v, [key]: val });
  return (
    <Modal title={v.id ? "编辑资料" : "添加项目资料"} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => save(v, files));
        }}
      >
        {!v.id && (
          <Field label="资料类型">
            <select
              value={v.kind}
              onChange={(e) => {
                change("kind", e.target.value);
                setFiles(null);
              }}
            >
              {[
                ["local", "本地文件或目录（只读引用）"],
                ["upload", "上传附件（保存副本）"],
                ["web", "网页 / 结构化接口"],
                ["codex", "Codex 会话（持续读取最新消息）"],
                ["inspire", "Inspire 实验结果"],
                ["text", "背景文本"],
              ].map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}
        {!v.id && v.kind === "upload" ? (
          <Field label="选择文件（每个不超过 20 MB）">
            <input
              type="file"
              multiple
              required
              onChange={(e) => setFiles(e.target.files)}
            />
            <small>
              支持
              PDF、文本、Notebook、DOCX、XLSX、图片。上传后可分别设置标题与活跃状态。
            </small>
          </Field>
        ) : (
          <>
            <Field label="标题">
              <input
                value={v.title}
                onChange={(e) => change("title", e.target.value)}
                placeholder="留空时使用文件名或网址"
              />
            </Field>
            {!v.id && v.kind === "local" && (
              <Field label="本地绝对路径">
                <input
                  required
                  placeholder="/Users/…/实验结果"
                  value={v.path || ""}
                  onChange={(e) => change("path", e.target.value)}
                />
              </Field>
            )}
            {!v.id && v.kind === "codex" && (
              <Field label="Codex 会话链接">
                <input
                  required
                  placeholder="codex://threads/会话ID"
                  value={v.url || ""}
                  onChange={(e) => change("url", e.target.value)}
                />
                <small>
                  只读最新用户消息和助手答复。标记活跃后参与项目检查；自动跟进仍由项目开关控制。
                </small>
              </Field>
            )}
            {!v.id && v.kind === "web" && (
              <Field label="网页地址">
                <input
                  type="url"
                  required
                  placeholder="http://127.0.0.1:… 或 https://…"
                  value={v.url || ""}
                  onChange={(e) => change("url", e.target.value)}
                />
              </Field>
            )}
            {!v.id && v.kind === "text" && (
              <Field label="背景内容">
                <textarea
                  required
                  rows={7}
                  value={v.content || ""}
                  onChange={(e) => change("content", e.target.value)}
                />
              </Field>
            )}
            {!v.id && v.kind === "inspire" && (
              <>
                <p className="project-warning">
                  复用本机 Inspire
                  登录，只读取状态、日志与已绑定结果。不会启停远端任务。
                </p>
                {[
                  ["account", "账号别名（可选）"],
                  ["workspace", "Workspace"],
                  ["resourceName", "资源名称"],
                  ["remotePath", "结果路径（可选，/inspire/…）"],
                ].map(([k, l]) => (
                  <Field key={k} label={l}>
                    <input
                      required={["workspace", "resourceName"].includes(k)}
                      value={v[k] || ""}
                      onChange={(e) => change(k, e.target.value)}
                    />
                  </Field>
                ))}
                <Field label="资源类型">
                  <select
                    value={v.resourceKind || "notebook"}
                    onChange={(e) => change("resourceKind", e.target.value)}
                  >
                    <option value="notebook">Notebook</option>
                    <option value="job">Job</option>
                  </select>
                </Field>
              </>
            )}
            <Field label="说明">
              <textarea
                rows={3}
                value={v.description}
                onChange={(e) => change("description", e.target.value)}
              />
            </Field>
            <div className="project-form-row">
              <Field label="分类">
                <input
                  value={v.category}
                  onChange={(e) => change("category", e.target.value)}
                />
              </Field>
              <Field label="标签（逗号分隔）">
                <input
                  value={v.tags?.join(", ") || ""}
                  onChange={(e) =>
                    change(
                      "tags",
                      e.target.value
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
            </div>
            <label className="material-active">
              <input
                type="checkbox"
                checked={v.active}
                onChange={(e) => change("active", e.target.checked)}
              />
              活跃资料 · 自动跟进开启后每小时检查
            </label>
          </>
        )}
        <footer className="project-modal-footer">
          {v.id && (
            <button
              type="button"
              className="secondary"
              onClick={() => void run(() => save({ ...v, removed: true }))}
            >
              移除引用
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "正在采集…" : v.id ? "保存资料" : "添加并采集"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ProjectChat({
  project,
  chats,
  tasks,
  refresh,
  close,
  onError,
  onMaterial,
}: any) {
  const [chatId, setChatId] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [input, setInput] = useState(""),
    [sending, setSending] = useState(false);
  const selected = chatId || chats[0]?.id;
  const running = tasks.find(
    (t: any) =>
      t.chatId === selected && ["queued", "running"].includes(t.status),
  );
  const latest = tasks.find((t: any) => t.chatId === selected);
  useEffect(() => {
    if (selected)
      void api<any[]>(`/chats/${selected}/messages`)
        .then(setMessages)
        .catch((e) => onError(e.message));
    else setMessages([]);
  }, [selected, tasks, onError]);
  async function send() {
    if (!input.trim()) return;
    setSending(true);
    try {
      let id = selected;
      if (!id) {
        const c = await api(`/projects/${project.id}/chats`, {
          method: "POST",
        });
        id = c.id;
        setChatId(id);
      }
      await api(`/projects/${project.id}/chats/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: input }),
      });
      setInput("");
      await refresh();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <aside className="project-chat">
      <header>
        <div>
          <Sparkles size={18} />
          <strong>{project.assistantName}</strong>
        </div>
        <button className="icon-btn" title="收起项目助手" onClick={close}>
          <X size={19} />
        </button>
      </header>
      <div className="project-chat-scope">
        {project.name} · 专属助手
        <br />
        可以对话导入资料、润色项目内容；事项修改需要确认。
      </div>
      <AssistantControls onError={onError} />
      <div className="project-chat-select">
        <select
          aria-label="项目会话"
          value={selected || ""}
          onChange={(e) => setChatId(e.target.value)}
        >
          <option value="" disabled>
            选择会话
          </option>
          {chats.map((c: any) => (
            <option key={c.id} value={c.id}>
              {date(c.createdAt)} · {c.title}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          title="新建项目会话"
          onClick={() =>
            void api(`/projects/${project.id}/chats`, { method: "POST" })
              .then((c) => {
                setChatId(c.id);
                return refresh();
              })
              .catch((e: any) => onError(e.message))
          }
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="project-chat-messages">
        {!messages.length && (
          <div className="project-empty">
            <Sparkles size={29} />
            <h3>和项目一起思考</h3>
            <p>可以说「添加资料：网址」，或「帮我润色并保存项目描述」。</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`project-message ${m.role}`}>
            <small>
              {m.role === "user"
                ? "你"
                : m.role === "system"
                  ? "工作台回执"
                  : "项目助手"}{" "}
              · {date(m.createdAt)}
            </small>
            {m.model && (
              <div className="assistant-edit-note">
                {m.model} · {m.reasoningEffort}
              </div>
            )}
            <Markdown
              text={m.content}
              onMaterial={(id) => void onMaterial(id)}
            />
            {m.importResults?.length > 0 && (
              <div className="assistant-import-results">
                {m.importResults.map((r: any, i: number) => (
                  <div key={i}>
                    {r.materialId && (
                      <button onClick={() => void onMaterial(r.materialId)}>
                        {r.duplicate ? "已在资料库" : "已导入"} ·{" "}
                        {r.title || r.source}
                      </button>
                    )}
                    {r.error && <span>{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="project-running">
            <RefreshCw size={14} className="spin" />
            {running.stage || "等待助手回复"}
          </div>
        )}
        {latest &&
          !running &&
          ["failed", "interrupted", "cancelled"].includes(latest.status) && (
            <div className="project-warning">
              {latest.error || statusNames[latest.status]}
              <button
                onClick={() =>
                  void api(`/tasks/${latest.id}/retry`, {
                    method: "POST",
                  }).catch((e: any) => onError(e.message))
                }
              >
                重试
              </button>
            </div>
          )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="给项目助手发送消息"
          placeholder="添加资料、润色描述，或询问下一步…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
        />
        <div>
          <small>会话保存在本地 · 内容会发送至 Codex</small>
          {running ? (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void api(`/tasks/${running.id}/cancel`, {
                  method: "POST",
                }).catch((e: any) => onError(e.message))
              }
            >
              <Square size={14} />
              停止
            </button>
          ) : (
            <button
              className="primary"
              title="发送消息"
              disabled={sending || !input.trim()}
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
