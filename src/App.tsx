import { useState, useEffect, useRef, useCallback } from "react";
import {
  Library,
  BookOpen,
  CalendarDays,
  FolderKanban,
  ClipboardCheck,
  Plus,
  Search,
  ArrowUpRight,
  ArrowLeft,
  LayoutGrid,
  List,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Link,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  Command,
  Tag,
  Activity,
  RefreshCw,
  Square,
  Settings,
  HardDrive,
  ExternalLink,
} from "lucide-react";
import {
  api,
  type Paper,
  type Annotation,
  type Analysis,
  type Task,
  type Chat,
} from "./types";
import ReviewsWorkspace from "./ReviewsWorkspace";
import PdfReader, { type SelectedText } from "./PdfReader";
import Details from "./Details";
import ChatPanel from "./ChatPanel";
import ProjectsWorkspace from "./ProjectsWorkspace";
import AssistantControls from "./AssistantControls";
const statusLabels: Record<string, string> = {
  unread: "待读",
  reading: "在读",
  read: "已读",
};
function ImportModal({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: (id?: string) => Promise<void>;
  onError: (s: string) => void;
}) {
  const [mode, setMode] = useState("file"),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<any[]>([]);
  const input = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | File[]) {
    setBusy(true);
    try {
      const data = new FormData();
      Array.from(files).forEach((f) => data.append("files", f));
      const r = await api<any[]>("/import/files", {
        method: "POST",
        body: data,
      });
      setResults(r);
      await onDone();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function fromUrl() {
    setBusy(true);
    try {
      const r = await api("/import/url", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      setResults([{ ...r, filename: url }]);
      await onDone();
    } catch (e: any) {
      setResults([{ filename: url, error: e.message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section className="modal import-modal">
        <header>
          <div>
            <span className="eyebrow">BUILD YOUR KNOWLEDGE</span>
            <h2>添加文献</h2>
          </div>
          <button
            className="icon-btn"
            disabled={busy}
            title="关闭导入"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <p className="modal-description">
          把值得思考的论文，留在自己的研究空间。
        </p>
        <div className="import-tabs">
          <button
            className={mode === "file" ? "active" : ""}
            onClick={() => setMode("file")}
          >
            <Upload size={16} />
            上传 PDF
          </button>
          <button
            className={mode === "url" ? "active" : ""}
            onClick={() => setMode("url")}
          >
            <Link size={16} />
            从链接导入
          </button>
        </div>
        {mode === "file" ? (
          <div
            className={`drop-zone ${busy ? "busy" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) void upload(e.dataTransfer.files);
            }}
            onClick={() => !busy && input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") input.current?.click();
            }}
          >
            <div className="upload-icon">
              {busy ? (
                <LoaderCircle className="spin" size={28} />
              ) : (
                <Upload size={28} />
              )}
            </div>
            <h3>{busy ? "正在导入并解析…" : "拖拽 PDF 到这里"}</h3>
            <p>或点击选择文件，支持批量添加</p>
            <span>PDF · 单篇最大 80 MB · 原文件保持不变</span>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
              }}
            />
          </div>
        ) : (
          <form
            className="url-form"
            onSubmit={(e) => {
              e.preventDefault();
              void fromUrl();
            }}
          >
            <label>论文链接</label>
            <input
              required
              type="url"
              placeholder="粘贴 arXiv、OpenReview 或 PDF 链接"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p>
              支持 arxiv.org/abs/…、openreview.net/forum?id=… 及公开 PDF 直链。
            </p>
            <button className="primary" disabled={busy || !url.trim()}>
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Plus size={15} />
              )}{" "}
              {busy ? "正在下载与解析…" : "导入文献"}
            </button>
          </form>
        )}
        {results.length > 0 && (
          <div className="import-results">
            {results.map((r, i) => (
              <div key={i} className={r.error ? "result error-text" : "result"}>
                {r.error ? (
                  <AlertCircle size={17} />
                ) : (
                  <CheckCircle2 size={17} />
                )}
                <div>
                  <strong>{r.paper?.title || r.filename}</strong>
                  <small>
                    {r.error ||
                      (r.duplicate
                        ? "已在文献库中，未重复导入"
                        : "已导入，等待你的下一次阅读")}
                  </small>
                </div>
                {r.paper && (
                  <button
                    className="text-btn"
                    onClick={() => void onDone(r.paper.id).then(onClose)}
                  >
                    打开
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="modal-foot">
          <HardDrive size={13} />
          文件保存在本机；导入不会自动运行 AI 分析。
        </div>
      </section>
    </div>
  );
}
export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]),
    [analyses, setAnalyses] = useState<Analysis[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [chats, setChats] = useState<Chat[]>([]),
    [annotations, setAnnotations] = useState<Annotation[]>([]),
    [selected, setSelected] = useState(
      localStorage.getItem("iid-selected") || "",
    ),
    [page, setPage] = useState(1),
    [tab, setTab] = useState("info"),
    [panel, setPanel] = useState(true),
    [chatOpen, setChatOpen] = useState(
      localStorage.getItem("iid-chat-open") === "true",
    ),
    [quote, setQuote] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [tag, setTag] = useState(""),
    [scoreFilter, setScoreFilter] = useState("all"),
    [sort, setSort] = useState("recent"),
    [view, setView] = useState("grid"),
    [showImport, setShowImport] = useState(false),
    [toast, setToast] = useState(""),
    [health, setHealth] = useState<any>(null),
    [showTasks, setShowTasks] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [ready, setReady] = useState(false);
  const [module, setModule] = useState(
    localStorage.getItem("iid-module") || "library",
  );
  useEffect(() => {
    localStorage.setItem("iid-module", module);
  }, [module]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingPosition = useRef<{ id: string; patch: any } | null>(null),
    selectedRef = useRef(selected);
  selectedRef.current = selected;
  const notify = useCallback((s: string) => {
    setToast(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const refresh = useCallback(async () => {
    const [p, a, t, c] = await Promise.all([
      api<Paper[]>("/papers"),
      api<Analysis[]>("/analyses"),
      api<Task[]>("/tasks"),
      api<Chat[]>("/chats"),
    ]);
    setPapers(p);
    setAnalyses(a);
    setTasks(t);
    setChats(c);
    const id = selectedRef.current;
    if (id) {
      const loaded = await api<Annotation[]>(`/papers/${id}/annotations`);
      if (selectedRef.current === id) setAnnotations(loaded);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    void refresh().catch((e) => notify(e.message));
    void api("/health")
      .then(setHealth)
      .catch((e) => notify(e.message));
    const sse = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout>;
    sse.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void refresh().catch((e) => notify(e.message)),
        160,
      );
    };
    return () => {
      sse.close();
      clearTimeout(timer);
    };
  }, [refresh, notify]);
  const paper = papers.find((p) => p.id === selected);
  useEffect(() => {
    localStorage.setItem("iid-selected", selected);
    if (paper) {
      setPage(paper.lastPage || 1);
      void api<Annotation[]>(`/papers/${selected}/annotations`)
        .then((a) => {
          if (selectedRef.current === selected) setAnnotations(a);
        })
        .catch((e) => notify(e.message));
    } else setAnnotations([]);
  }, [selected, !!paper]);
  useEffect(() => {
    localStorage.setItem("iid-chat-open", String(chatOpen));
  }, [chatOpen]);
  const flushPosition = () => {
    const pending = pendingPosition.current;
    if (pending) {
      pendingPosition.current = null;
      void api(`/papers/${pending.id}`, {
        method: "PATCH",
        body: JSON.stringify(pending.patch),
      }).catch((e) => notify(e.message));
    }
  };
  function position(patch: any) {
    if (!paper) return;
    setPapers((ps) =>
      ps.map((p) => (p.id === paper.id ? { ...p, ...patch } : p)),
    );
    if (pendingPosition.current?.id !== paper.id) flushPosition();
    pendingPosition.current = {
      id: paper.id,
      patch: { ...pendingPosition.current?.patch, ...patch },
    };
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = setTimeout(flushPosition, 450);
  }
  useEffect(() => {
    const listener = () => {
      const p = pendingPosition.current;
      if (p)
        fetch(`/api/papers/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p.patch),
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", listener);
    return () => window.removeEventListener("pagehide", listener);
  }, []);
  function openPaper(id: string) {
    flushPosition();
    setSelected(id);
    setPanel(true);
    setTab("info");
  }
  function gotoPage(n: number) {
    if (!paper) return;
    const v = Math.max(1, Math.min(paper.pageCount, n));
    setPage(v);
    position({ lastPage: v });
  }
  const savePaper = async (patch: any) => {
    if (!paper) return;
    const updated = await api<Paper>(`/papers/${paper.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setPapers((ps) =>
      ps.map((p) =>
        p.id === updated.id
          ? { ...updated, lastPage: p.lastPage, zoom: p.zoom }
          : p,
      ),
    );
  };
  const startTask = async (type: string) => {
    if (!paper) return;
    await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ type, paperId: paper.id }),
    });
    await refresh();
  };
  function ask(text: string) {
    setQuote(text);
    setChatOpen(true);
  }
  const tags = [...new Set(papers.flatMap((p) => p.tags))].sort();
  const scores = new Map(
    analyses
      .filter((a) => a.type === "paper")
      .reverse()
      .map((a) => [a.paperId, a.score]),
  );
  const filtered = papers
    .filter(
      (p) =>
        (filter === "all" || p.status === filter) &&
        (!tag || p.tags.includes(tag)) &&
        (scoreFilter === "all" || p.manualScore === Number(scoreFilter)) &&
        [p.title, p.authors, p.meaning, p.venue, p.year, ...p.tags]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "score"
        ? (b.manualScore || 0) - (a.manualScore || 0)
        : sort === "title"
          ? a.title.localeCompare(b.title)
          : b.createdAt.localeCompare(a.createdAt),
    );
  const running = tasks.filter((t) =>
    ["running", "queued", "waiting_url", "waiting_selection"].includes(
      t.status,
    ),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            flushPosition();
            setSelected("");
          }}
        >
          <div className="brand-mark">
            i<span>i</span>d<span className="brand-dot">.</span>
          </div>
          <div className="brand-caption">RESEARCH WORKSPACE</div>
        </a>
        <div className="workspace-label">
          <div className="workspace-avatar">Z</div>
          <div>
            <strong>我的研究空间</strong>
            <span>Personal workspace</span>
          </div>
          <span className="local-badge">LOCAL</span>
        </div>
        <p className="nav-label">工作空间</p>
        <nav>
          <button
            className={`nav-item ${module === "library" ? "active" : ""}`}
            onClick={() => {
              flushPosition();
              setSelected("");
              setFilter("all");
              setTag("");
              setModule("library");
            }}
          >
            <Library size={18} />
            <span>文献整理</span>
            <b>{papers.length}</b>
          </button>
          <button
            className={`nav-item ${module === "projects" ? "active" : ""}`}
            onClick={() => {
              flushPosition();
              setModule("projects");
              setChatOpen(false);
            }}
          >
            <FolderKanban size={18} />
            <span>项目跟进</span>
          </button>
          <button className={`nav-item ${module === "reviews" ? "active" : ""}`} onClick={() => { flushPosition(); setModule("reviews"); setChatOpen(false); }}><ClipboardCheck size={18}/><span>审稿工作</span></button>
          {[

            { Icon: CalendarDays, label: "日程安排" },
          ].map(({ Icon, label }) => (
            <button
              key={label}
              className="nav-item future"
              onClick={() =>
                notify(`${label}将在后续版本开放；当前版本聚焦文献整理。`)
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              <small>即将上线</small>
            </button>
          ))}
        </nav>
        {module === "library" ? (
          <>
            <div className="sidebar-divider" />
            <div className="nav-label label-row">
              文献视图 <BookOpen size={13} />
            </div>
            <div className="library-views">
              {[
                ["all", "全部文献"],
                ["unread", "待读清单"],
                ["reading", "正在阅读"],
                ["read", "已读归档"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={filter === v && !selected ? "active" : ""}
                  onClick={() => {
                    flushPosition();
                    setModule("library");
                    setFilter(v);
                    setSelected("");
                  }}
                >
                  <span className={`status-dot ${v}`} />
                  <span>{l}</span>
                  <small>
                    {v === "all"
                      ? papers.length
                      : papers.filter((p) => p.status === v).length}
                  </small>
                </button>
              ))}
            </div>
            <div className="sidebar-divider" />
            <div className="nav-label label-row">
              我的标签 <Tag size={13} />
            </div>
            <div className="sidebar-tags">
              {tags.length ? (
                tags.map((t) => (
                  <button
                    key={t}
                    className={tag === t ? "active" : ""}
                    onClick={() => {
                      setTag(tag === t ? "" : t);
                      setSelected("");
                    }}
                  >
                    <span>#</span>
                    {t}
                  </button>
                ))
              ) : (
                <p>
                  为论文添加标签
                  <br />
                  慢慢建立你的知识索引
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="project-sidebar-guide">
            <span className="eyebrow">{module === "reviews" ? "REVIEW WORKSPACE" : "PROJECT WORKSPACE"}</span>
            <p>{module === "reviews" ? "审阅有据，判断由你" : "聚焦当前研究"}</p>
            <span>{module === "reviews" ? "从原文出发，记录质疑，逐步形成审稿意见。" : "资料与来源持续积累，助手梳理进展，下一步由你决定。"}</span>
            <div>{module === "reviews" ? "AI 先生成候选稿，你可以按章节采用、编辑和导出。" : "自动跟进按项目独立开启。关闭网页后，后端运行期间仍可检查。"}</div>
          </div>
        )}
        <div className="sidebar-bottom">
          <button onClick={() => setShowTasks(true)}>
            <Activity size={16} />
            <span>任务中心</span>
            {running.length > 0 && <b>{running.length}</b>}
          </button>
          <button onClick={() => setShowSettings(true)}>
            <Settings size={16} />
            <span>设置与本地数据</span>
          </button>
          <div className="local-status">
            <span className="online-dot" />
            本地工作台 <span>v1.0</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{module === "projects" ? "项目跟进" : module === "reviews" ? "审稿工作" : "文献整理"}</strong>
            {paper && module === "library" && (
              <>
                <ChevronRight size={14} />
                <span className="truncate">阅读工作区</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <HardDrive size={13} />
              本地存储
            </span>
            <button
              className={`ai-toggle ${chatOpen ? "active" : ""}`}
              onClick={() =>
                module === "reviews" ? window.dispatchEvent(new Event("iid-review-ai")) : module === "projects"
                  ? window.dispatchEvent(new Event("iid-project-ai"))
                  : setChatOpen(!chatOpen)
              }
            >
              <Sparkles size={15} />
              AI 助手<span className="keycap">⌘ J</span>
            </button>
          </div>
        </header>
        {module === "reviews" ? <ReviewsWorkspace onError={notify}/> : module === "projects" ? (
          <ProjectsWorkspace onError={notify} />
        ) : paper ? (
          <>
            <div className="reading-header">
              <button
                className="icon-btn back-button"
                title="返回文献库"
                onClick={() => {
                  flushPosition();
                  setSelected("");
                }}
              >
                <ArrowLeft size={19} />
              </button>
              <div>
                <span className="eyebrow">READING ROOM</span>
                <h1 title={paper.title}>{paper.title}</h1>
              </div>
              <span className={`status-pill ${paper.status}`}>
                {statusLabels[paper.status]}
              </span>
              <button
                className="icon-btn panel-toggle"
                title="切换详情栏"
                onClick={() => setPanel(!panel)}
              >
                {panel ? (
                  <PanelRightClose size={19} />
                ) : (
                  <PanelRightOpen size={19} />
                )}
              </button>
            </div>
            <div className="reading-layout">
              <PdfReader
                key={paper.id}
                paper={paper}
                page={page}
                onPage={gotoPage}
                annotations={annotations}
                onPosition={position}
                onQuote={ask}
                onAdd={async (s: SelectedText, comment, color) => {
                  await api(`/papers/${paper.id}/annotations`, {
                    method: "POST",
                    body: JSON.stringify({ ...s, comment, color }),
                  });
                  setAnnotations(await api(`/papers/${paper.id}/annotations`));
                  setTab("notes");
                }}
              />
              {panel && (
                <Details
                  key={paper.id}
                  paper={paper}
                  page={page}
                  annotations={annotations}
                  analyses={analyses.filter((a) => a.paperId === paper.id)}
                  tasks={tasks}
                  tab={tab}
                  setTab={setTab}
                  onSave={savePaper}
                  onPage={gotoPage}
                  onTask={startTask}
                  onQuote={ask}
                  refresh={refresh}
                  onError={notify}
                />
              )}
            </div>
          </>
        ) : (
          <div className="library-page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR IDEAS START HERE</span>
                <h1>
                  把阅读，变成研究的积累<span className="heading-dot">.</span>
                </h1>
                <p>收藏有价值的论文，记录自己的理解，让每一次阅读留下线索。</p>
              </div>
              <button className="primary" onClick={() => setShowImport(true)}>
                <Plus size={17} />
                添加文献
              </button>
            </div>
            <div className="stats-row">
              <div>
                <div className="stat-icon">
                  <Library size={19} />
                </div>
                <span>
                  文献总量
                  <strong>
                    {papers.length}
                    <small>篇</small>
                  </strong>
                </span>
                <svg viewBox="0 0 80 35" className="sparkline">
                  <path d="M1 32 L13 24 L25 27 L38 15 L50 18 L62 8 L79 4" />
                </svg>
              </div>
              <div>
                <div className="stat-icon amber">
                  <BookOpen size={19} />
                </div>
                <span>
                  正在阅读
                  <strong>
                    {papers.filter((p) => p.status === "reading").length}
                    <small>篇</small>
                  </strong>
                </span>
              </div>
              <div>
                <div className="stat-icon purple">
                  <Sparkles size={19} />
                </div>
                <span>
                  已完成 AI 分析
                  <strong>
                    {
                      new Set(
                        analyses
                          .filter((a) => a.type === "paper")
                          .map((a) => a.paperId),
                      ).size
                    }
                    <small>篇</small>
                  </strong>
                </span>
              </div>
              <div>
                <div className="stat-icon blue">
                  <NotebookIcon />
                </div>
                <span>
                  已记录笔记
                  <strong>
                    {papers.filter((p) => p.note?.trim()).length}
                    <small>篇</small>
                  </strong>
                </span>
              </div>
            </div>
            <section className="library-section">
              <div className="library-title">
                <h2>
                  {tag
                    ? "# " + tag
                    : filter === "all"
                      ? "我的文献"
                      : filter === "unread"
                        ? "待读清单"
                        : filter === "reading"
                          ? "正在阅读"
                          : "已读归档"}
                  <span>{filtered.length}</span>
                </h2>
                <div className="view-toggle">
                  <button
                    title="卡片视图"
                    className={view === "grid" ? "active" : ""}
                    onClick={() => setView("grid")}
                  >
                    <LayoutGrid size={16} />
                  </button>
                  <button
                    title="列表视图"
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <List size={18} />
                  </button>
                </div>
              </div>
              <div className="filter-bar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    aria-label="搜索文献"
                    placeholder="搜索标题、作者、TL;DR、会议 / 期刊…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button title="清空搜索" onClick={() => setSearch("")}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <select
                  aria-label="阅读状态筛选"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="unread">待读</option>
                  <option value="reading">在读</option>
                  <option value="read">已读</option>
                </select>
                <select
                  aria-label="创新评分筛选"
                  value={scoreFilter}
                  onChange={(e) => setScoreFilter(e.target.value)}
                >
                  <option value="all">创新评分</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} 分
                    </option>
                  ))}
                </select>
                <select
                  aria-label="文献排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recent">最近添加</option>
                  <option value="score">创新评分优先</option>
                  <option value="title">标题排序</option>
                </select>
              </div>
              {tag && (
                <button className="filter-chip" onClick={() => setTag("")}>
                  #{tag}
                  <X size={12} />
                </button>
              )}
              {!ready ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <h2>正在打开研究空间…</h2>
                </div>
              ) : filtered.length ? (
                <div className={view === "grid" ? "paper-grid" : "paper-list"}>
                  {filtered.map((p, i) => (
                    <button
                      className="paper-card"
                      key={p.id}
                      onClick={() => openPaper(p.id)}
                    >
                      <div className="card-top">
                        <div className={`paper-glyph tone-${i % 4}`}>
                          <FileText size={23} />
                        </div>
                        <span className={`status-pill ${p.status}`}>
                          {statusLabels[p.status]}
                        </span>
                        <ArrowUpRight className="card-arrow" size={17} />
                      </div>
                      <h3>{p.title}</h3>
                      <p className="card-authors">
                        {p.authors || "作者待补充"}
                      </p>
                      <p
                        className={`card-publication ${!p.venue?.trim() ? "pending" : ""}`}
                        title={p.venue || "会议 / 期刊待补充"}
                      >
                        <BookOpen size={12} />
                        <span>{p.venue?.trim() || "会议 / 期刊待补充"}</span>
                        {p.year && <time>{p.year}</time>}
                      </p>
                      <div className="card-tldr">
                        <span className="card-tldr-label">
                          TL;DR <span>我的方法印象</span>
                        </span>
                        <p
                          className={`card-meaning ${!p.meaning?.trim() ? "placeholder" : ""}`}
                          title={p.meaning || undefined}
                        >
                          {p.meaning?.trim() ||
                            "还没有写下方法印象，打开文献添加 TL;DR。"}
                        </p>
                      </div>
                      <div className="card-tags">
                        {p.tags.slice(0, 3).map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                        {!p.tags.length && (
                          <span className="muted">未添加标签</span>
                        )}
                      </div>
                      <div className="card-bottom">
                        <span>
                          {p.pageCount} 页<span className="dot-sep">·</span>
                          {new Date(p.createdAt).toLocaleDateString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                          })}
                        </span>
                        <div>
                          {scores.has(p.id) && (
                            <span className="mini-ai">
                              <Sparkles size={11} /> {scores.get(p.id)}/5
                            </span>
                          )}
                          <span className="mini-score">
                            ★ <strong>{p.manualScore ?? "—"}</strong>
                            <small>/5</small>
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-art">
                    <div className="empty-paper back" />
                    <div className="empty-paper front">
                      <FileText size={36} />
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="empty-spark">
                      <Sparkles size={18} />
                    </span>
                  </div>
                  <span className="eyebrow">A SPACE FOR DEEPER THINKING</span>
                  <h2>
                    {papers.length
                      ? "暂时没有匹配的论文"
                      : "你的下一次灵感，从一篇论文开始"}
                  </h2>
                  <p>
                    {papers.length
                      ? "试试其他关键词或筛选条件。"
                      : "添加第一篇论文，开启阅读、批注与 AI 讨论。"}
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      papers.length
                        ? (setSearch(""),
                          setFilter("all"),
                          setScoreFilter("all"),
                          setTag(""))
                        : setShowImport(true)
                    }
                  >
                    <Plus size={16} />
                    {papers.length ? "清除筛选" : "添加第一篇文献"}
                  </button>
                  <div className="empty-features">
                    <span>
                      <HighlighterIcon />
                      高亮与批注
                    </span>
                    <span>
                      <Sparkles size={14} />
                      AI 深入分析
                    </span>
                    <span>
                      <HardDrive size={14} />
                      本地保存
                    </span>
                  </div>
                </div>
              )}
            </section>
            <footer className="library-footer">
              <span>IID RESEARCH WORKSPACE</span>
              <p>Read thoughtfully. Connect ideas. Make progress.</p>
            </footer>
          </div>
        )}
      </main>
      {chatOpen && module === "library" && (
        <ChatPanel
          paper={paper}
          chats={chats}
          tasks={tasks}
          analyses={analyses}
          quote={quote}
          onClearQuote={() => setQuote("")}
          onClose={() => setChatOpen(false)}
          refresh={refresh}
          onPage={gotoPage}
          onError={notify}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={async (id) => {
            await refresh();
            if (id) openPaper(id);
          }}
          onError={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {showTasks && (
        <div className="modal-backdrop">
          <section className="modal tasks-modal">
            <header>
              <div>
                <span className="eyebrow">BACKGROUND TASKS</span>
                <h2>任务中心</h2>
              </div>
              <button
                className="icon-btn"
                title="关闭任务中心"
                onClick={() => setShowTasks(false)}
              >
                <X />
              </button>
            </header>
            <div className="task-list">
              {tasks.length ? (
                tasks.map((t) => (
                  <div key={t.id} className="task-item">
                    <div>
                      <strong>
                        {t.type === "paper"
                          ? "论文分析"
                          : t.type === "openreview"
                            ? "OpenReview 分析"
                            : t.type === "project_check"
                              ? "项目检查"
                              : t.type === "project_chat"
                                ? "项目助手会话"
                                : "AI 会话"}
                      </strong>
                      <span className={`task-status ${t.status}`}>
                        {
                          (
                            {
                              completed: "已完成",
                              running: "运行中",
                              queued: "排队中",
                              failed: "失败",
                              interrupted: "已中断",
                              cancelled: "已取消",
                              waiting_url: "等待网址",
                              waiting_selection: "等待选择",
                            } as any
                          )[t.status]
                        }
                      </span>
                    </div>
                    <p>
                      {papers.find((p) => p.id === t.paperId)?.title ||
                        (t.projectId ? "项目工作区" : "通用会话")}
                    </p>
                    <small>{t.error || t.stage}</small>
                    <div className="task-item-actions">
                      {t.projectId && (
                        <button
                          className="text-btn"
                          onClick={() => {
                            localStorage.setItem("iid-project", t.projectId!);
                            setModule("projects");
                            setShowTasks(false);
                            window.dispatchEvent(
                              new CustomEvent("iid-open-project", {
                                detail: t.projectId,
                              }),
                            );
                          }}
                        >
                          查看项目
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                      {t.paperId && (
                        <button
                          className="text-btn"
                          onClick={() => {
                            openPaper(t.paperId!);
                            setTab(t.type === "chat" ? "info" : t.type);
                            setShowTasks(false);
                            if (t.type === "chat") setChatOpen(true);
                          }}
                        >
                          查看
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                      {["failed", "interrupted", "cancelled"].includes(
                        t.status,
                      ) && (
                        <button
                          className="text-btn"
                          onClick={() =>
                            void api(`/tasks/${t.id}/retry`, { method: "POST" })
                              .then(refresh)
                              .catch((e) => notify(e.message))
                          }
                        >
                          <RefreshCw size={12} />
                          重试
                        </button>
                      )}
                      {[
                        "running",
                        "queued",
                        "waiting_url",
                        "waiting_selection",
                      ].includes(t.status) && (
                        <button
                          className="text-btn"
                          onClick={() =>
                            void api(`/tasks/${t.id}/cancel`, {
                              method: "POST",
                            })
                              .then(refresh)
                              .catch((e) => notify(e.message))
                          }
                        >
                          <Square size={12} />
                          取消
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="small-empty">
                  还没有 AI 任务。从论文详情中发起分析。
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {showSettings && (
        <div className="modal-backdrop">
          <section className="modal settings-modal">
            <header>
              <div>
                <span className="eyebrow">LOCAL FIRST</span>
                <h2>设置与本地数据</h2>
              </div>
              <button
                className="icon-btn"
                title="关闭设置"
                onClick={() => setShowSettings(false)}
              >
                <X />
              </button>
            </header>
            <div className="setting-block">
              <h3>Codex 连接</h3>
              <p>
                <span
                  className={health?.loggedIn ? "online-dot" : "offline-dot"}
                />
                {health?.loggedIn
                  ? "已通过本机 ChatGPT 登录"
                  : "尚未登录或 CLI 不可用"}
              </p>
              <AssistantControls onError={notify} />
              <small>当前账号的模型调用权限将在首次任务时验证。</small>
              <button
                className="secondary compact"
                onClick={() =>
                  void api("/health")
                    .then(setHealth)
                    .catch((e) => notify(e.message))
                }
              >
                <RefreshCw size={13} />
                检查连接
              </button>
            </div>
            <div className="setting-block">
              <h3>文件与隐私</h3>
              <p>数据目录</p>
              <code className="path-code">
                {health?.dataDirectory || "data/"}
              </code>
              <p>
                PDF、笔记、会话和分析记录保存在本机。运行 AI
                时，会将当前论文和所选材料发送至 Codex。
              </p>
            </div>
            <div className="setting-block">
              <h3>备份与恢复</h3>
              <p>在项目目录打开终端：</p>
              <code className="path-code">npm run backup</code>
              <p>恢复（先停止平台）：</p>
              <code className="path-code">
                npm run restore -- /完整路径/备份文件.tar.gz
              </code>
              <small>恢复前自动保留现有数据副本。详细说明见项目 README。</small>
            </div>
          </section>
        </div>
      )}
      <KeyboardShortcut
        onToggle={() =>
          module === "reviews" ? window.dispatchEvent(new Event("iid-review-ai")) : module === "projects"
            ? window.dispatchEvent(new Event("iid-project-ai"))
            : setChatOpen((v) => !v)
        }
        onImport={() => setShowImport(true)}
      />
    </div>
  );
}
function KeyboardShortcut({
  onToggle,
  onImport,
}: {
  onToggle: () => void;
  onImport: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        onToggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        onImport();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggle, onImport]);
  return null;
}
function NotebookIcon() {
  return <BookOpen size={19} />;
}
function HighlighterIcon() {
  return <FileText size={14} />;
}
