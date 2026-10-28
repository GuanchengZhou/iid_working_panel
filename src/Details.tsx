import { useState, useEffect, useRef } from "react";
import {
  FileText,
  NotebookPen,
  Sparkles,
  MessagesSquare,
  Highlighter,
  Trash2,
  ArrowUpRight,
  Check,
  Link,
  Play,
  RefreshCw,
  Square,
  ChevronDown,
  Save,
} from "lucide-react";
import {
  api,
  type Paper,
  type Annotation,
  type Analysis,
  type Task,
} from "./types";
import Markdown from "./Markdown";
function NoteEditor({
  paper,
  page,
  onSave,
  onPage,
}: {
  paper: Paper;
  page: number;
  onSave: (p: any) => Promise<void>;
  onPage: (n: number) => void;
}) {
  const [note, setNote] = useState(paper.note),
    [preview, setPreview] = useState(false),
    [state, setState] = useState("已保存");
  const latest = useRef(paper.note),
    saved = useRef(paper.note),
    saveFn = useRef(onSave);
  saveFn.current = onSave;
  async function persist(value: string) {
    if (value === saved.current) return;
    setState("保存中…");
    try {
      await saveFn.current({ note: value });
      saved.current = value;
      setState(latest.current === value ? "已保存" : "等待保存");
    } catch (e: any) {
      setState("保存失败：" + e.message);
    }
  }
  useEffect(() => {
    latest.current = note;
    const t = setTimeout(() => void persist(note), 700);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(
    () => () => {
      if (latest.current !== saved.current)
        void saveFn.current({ note: latest.current }).catch(() => {});
    },
    [],
  );
  return (
    <div className="note-editor">
      <div className="section-heading">
        <span>阅读笔记</span>
        <span className="save-status">
          {state === "已保存" && <Check size={12} />} {state}
        </span>
      </div>
      <div className="note-toolbar">
        <div className="segmented">
          <button
            className={!preview ? "active" : ""}
            onClick={() => setPreview(false)}
          >
            编辑
          </button>
          <button
            className={preview ? "active" : ""}
            onClick={() => setPreview(true)}
          >
            预览
          </button>
        </div>
        <button
          className="text-btn"
          onClick={() => {
            setNote((n) => n + ` [第 ${page} 页](paper-page:${page}) `);
            setPreview(false);
          }}
        >
          插入当前页
        </button>
      </div>
      {preview ? (
        <Markdown text={note || "还没有笔记。"} onPage={onPage} />
      ) : (
        <textarea
          className="note-area"
          aria-label="整篇阅读笔记"
          placeholder={
            "记录你的理解，而不只是摘抄。\n\n## 研究问题\n\n## 方法与启发\n\n## 待进一步核查\n\n支持 Markdown；可插入页码引用。"
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <button className="secondary compact" onClick={() => void persist(note)}>
        <Save size={13} />
        保存笔记
      </button>
    </div>
  );
}
function TldrEditor({
  value,
  onSave,
  onError,
}: {
  value: string;
  onSave: (patch: any) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(value),
    [saving, setSaving] = useState(false);
  async function save() {
    if (draft === value || saving) return;
    setSaving(true);
    try {
      await onSave({ meaning: draft });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="detail-section tldr-editor">
      <h3>
        TL;DR <small>我的方法印象</small>
      </h3>
      <p className="tldr-hint">
        写一段自己对方法最深的印象，会显示在“我的文献”中。
      </p>
      <textarea
        className="meaning-input"
        aria-label="TL;DR"
        placeholder="这个方法最让我印象深刻的是什么？记下它的核心直觉、独特之处，或对自己研究的启发。"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
      />
      <div className="tldr-save-row">
        <span>
          {saving
            ? "保存中…"
            : draft === value
              ? "已保存"
              : "尚未保存 · 离开输入框时自动保存"}
        </span>
        <button
          className="secondary compact"
          disabled={saving || draft === value}
          onClick={() => void save()}
        >
          保存 TL;DR
        </button>
      </div>
    </div>
  );
}
function ReviewMaterial({
  task,
  paper,
  onResume,
  onSave,
}: {
  task?: Task;
  paper: Paper;
  onResume: (id: string, body: any) => Promise<void>;
  onSave: (p: any) => Promise<void>;
}) {
  const [url, setUrl] = useState(paper.openreviewUrl),
    [manual, setManual] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const canResume =
    !!task &&
    ["waiting_url", "waiting_selection", "failed", "interrupted"].includes(
      task.status,
    );
  async function submit(body: any) {
    setBusy(true);
    setErr("");
    try {
      if (task && canResume) await onResume(task.id, body);
      else if (body.url) await onSave({ openreviewUrl: body.url });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review-material">
      <label>OpenReview 网址</label>
      <div className="input-row">
        <input
          placeholder="https://openreview.net/forum?id=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="secondary compact"
          disabled={busy || !url.trim() || (!!task && !canResume)}
          onClick={() => void submit({ url })}
        >
          {canResume ? "继续" : "保存"}
        </button>
      </div>
      {task?.candidates?.map((c) => (
        <button
          key={c.url}
          className="candidate"
          onClick={() => void submit({ url: c.url })}
        >
          <strong>{c.title}</strong>
          <span>{c.authors}</span>
          <small>{c.reason}</small>
        </button>
      ))}
      <button className="text-btn" onClick={() => setShow(!show)}>
        {show ? "收起" : "无法获取？粘贴审稿文本"}
        <ChevronDown size={13} />
      </button>
      {show && (
        <>
          <textarea
            placeholder="粘贴审稿意见、AC 意见及最终决定，并尽量附上来源链接和 reviewer 标识。"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            className="secondary compact"
            disabled={!canResume || !manual.trim() || busy}
            onClick={() => void submit({ manualText: manual })}
          >
            分析提供的评论
          </button>
          {!task && <small>请先点击“分析 OpenReview”，再补充文本。</small>}
          {task && !canResume && <small>任务进行中，请等待分析完成。</small>}
        </>
      )}
      {err && <p className="error-text">{err}</p>}
    </div>
  );
}
export default function Details({
  paper,
  page,
  annotations,
  analyses,
  tasks,
  tab,
  setTab,
  onSave,
  onPage,
  onTask,
  onQuote,
  refresh,
  onError,
}: {
  paper: Paper;
  page: number;
  annotations: Annotation[];
  analyses: Analysis[];
  tasks: Task[];
  tab: string;
  setTab: (s: string) => void;
  onSave: (patch: any) => Promise<void>;
  onPage: (n: number) => void;
  onTask: (type: string) => Promise<void>;
  onQuote: (s: string) => void;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [fields, setFields] = useState({ ...paper, tags: paper.tags.join(", ") }),
    [selectedVersion, setSelectedVersion] = useState(""),
    [snapshot, setSnapshot] = useState<any>(null);
  const relevant = analyses.filter(
      (a) => a.paperId === paper.id && a.type === tab,
    ),
    analysis = relevant.find((a) => a.id === selectedVersion) || relevant[0];
  const latestTask = tasks.find(
    (t) => t.paperId === paper.id && t.type === tab,
  );
  const task =
    latestTask && latestTask.status !== "completed" ? latestTask : undefined;
  const live = !!task && ["queued", "running"].includes(task.status);
  const resume = async (id: string, body: any) => {
    await api(`/tasks/${id}/material`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    await refresh();
  };
  async function updateAnnotation(a: Annotation, patch: any) {
    try {
      await api(`/annotations/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await refresh();
    } catch (e: any) {
      onError(e.message);
    }
  }
  return (
    <aside className="details-panel">
      <div className="detail-tabs">
        {[
          { id: "info", icon: FileText, label: "信息" },
          { id: "notes", icon: NotebookPen, label: "笔记" },
          { id: "paper", icon: Sparkles, label: "论文分析" },
          { id: "openreview", icon: MessagesSquare, label: "评审" },
        ].map((t) => (
          <button
            className={tab === t.id ? "active" : ""}
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setSelectedVersion("");
              setSnapshot(null);
            }}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="detail-content">
        {tab === "info" && (
          <>
            <div className="section-heading">
              <span>文献档案</span>
              <button
                className="text-btn"
                onClick={() => {
                  setFields({ ...paper, tags: paper.tags.join(", ") });
                  setEditing(!editing);
                }}
              >
                {editing ? "取消" : "编辑信息"}
              </button>
            </div>
            {editing ? (
              <form
                className="metadata-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSave({
                    title: fields.title,
                    authors: fields.authors,
                    year: fields.year,
                    venue: fields.venue,
                    abstract: fields.abstract,
                    tags: fields.tags
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                    .then(() => setEditing(false))
                    .catch((e) => onError(e.message));
                }}
              >
                {[
                  { k: "title", label: "标题" },
                  { k: "authors", label: "作者" },
                  { k: "year", label: "年份" },
                  { k: "venue", label: "会议 / 期刊" },
                  { k: "tags", label: "标签（逗号分隔）" },
                ].map(({ k, label }) => (
                  <label key={k}>
                    {label}
                    <input
                      required={k === "title"}
                      value={String(fields[k as keyof typeof fields])}
                      onChange={(e) =>
                        setFields({ ...fields, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  摘要
                  <textarea
                    value={fields.abstract}
                    onChange={(e) =>
                      setFields({ ...fields, abstract: e.target.value })
                    }
                  />
                </label>
                <button className="primary compact">保存信息</button>
              </form>
            ) : (
              <>
                <h2 className="paper-detail-title">{paper.title}</h2>
                <p className="authors">{paper.authors || "作者待补充"}</p>
                <div className="meta-grid">
                  <div>
                    <label>年份</label>
                    <span>{paper.year || "—"}</span>
                  </div>
                  <div>
                    <label>会议 / 期刊</label>
                    <span>{paper.venue || "—"}</span>
                  </div>
                  <div>
                    <label>页数</label>
                    <span>{paper.pageCount} 页</span>
                  </div>
                  <div>
                    <label>标识</label>
                    <span>{paper.identifier || "本地 PDF"}</span>
                  </div>
                </div>
                <div className="tags">
                  {paper.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                  <button
                    className="add-tag"
                    onClick={() => {
                      setFields({ ...paper, tags: paper.tags.join(", ") });
                      setEditing(true);
                    }}
                  >
                    ＋ 标签
                  </button>
                </div>
              </>
            )}
            <TldrEditor
              key={paper.id}
              value={paper.meaning}
              onSave={onSave}
              onError={onError}
            />
            <div className="detail-section">
              <h3>阅读状态</h3>
              <div className="status-picker">
                {[
                  ["unread", "待读"],
                  ["reading", "在读"],
                  ["read", "已读"],
                ].map(([s, l]) => (
                  <button
                    key={s}
                    className={paper.status === s ? "active" : ""}
                    onClick={() =>
                      void onSave({ status: s }).catch((e) =>
                        onError(e.message),
                      )
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="detail-section">
              <h3>
                创新程度 <small>人工评分</small>
              </h3>
              <div className="score-picker">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    className={(paper.manualScore || 0) >= n ? "filled" : ""}
                    key={n}
                    title={`${n} / 5`}
                    onClick={() =>
                      void onSave({
                        manualScore: paper.manualScore === n ? null : n,
                      }).catch((e) => onError(e.message))
                    }
                  >
                    ★
                  </button>
                ))}
                <span>
                  {paper.manualScore ? paper.manualScore + " / 5" : "未评分"}
                </span>
              </div>
              <p className="help">
                1 常规应用 · 2 小幅改进 · 3 方法改进
                <br />4 显著新思路 · 5 突破性贡献
              </p>
              {analyses.find((a) => a.type === "paper") && (
                <div className="ai-score">
                  <Sparkles size={14} />
                  AI 创新评分{" "}
                  <strong>
                    {analyses.find((a) => a.type === "paper")?.score} / 5
                  </strong>
                </div>
              )}
            </div>
            <div className="detail-section">
              <h3>摘要</h3>
              <p className="abstract">
                {paper.abstract || "尚未提取到摘要，可在编辑信息中补充。"}
              </p>
            </div>
            {paper.sourceUrl && (
              <a
                className="source-link"
                href={paper.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开论文来源
                <ArrowUpRight size={14} />
              </a>
            )}
            <p className="help">
              添加于 {new Date(paper.createdAt).toLocaleDateString("zh-CN")}
            </p>
          </>
        )}
        {tab === "notes" && (
          <>
            <NoteEditor
              key={paper.id}
              paper={paper}
              page={page}
              onSave={onSave}
              onPage={onPage}
            />
            <div className="detail-section">
              <h3>
                <Highlighter size={15} />
                高亮与批注 <small>{annotations.length}</small>
              </h3>
              {!annotations.length && (
                <div className="small-empty">
                  在 PDF 中选中文字，即可添加高亮和批注。
                </div>
              )}
              {annotations.map((a) => (
                <div key={a.id} className={`annotation-card ${a.color}`}>
                  <button
                    className="annotation-quote"
                    onClick={() => onPage(a.page)}
                  >
                    {a.text}
                  </button>
                  <textarea
                    aria-label="批注内容"
                    defaultValue={a.comment}
                    placeholder="添加批注…"
                    onBlur={(e) => {
                      if (e.target.value !== a.comment)
                        void updateAnnotation(a, { comment: e.target.value });
                    }}
                  />
                  <div className="annotation-footer">
                    <button
                      className="page-link"
                      onClick={() => onPage(a.page)}
                    >
                      第 {a.page} 页
                    </button>
                    <div className="colors">
                      {["yellow", "green", "purple"].map((c) => (
                        <button
                          key={c}
                          aria-label={`批注颜色 ${c}`}
                          className={`color-dot ${c} ${a.color === c ? "chosen" : ""}`}
                          onClick={() => void updateAnnotation(a, { color: c })}
                        />
                      ))}
                    </div>
                    <button
                      className="icon-btn"
                      title="询问 AI"
                      onClick={() =>
                        onQuote(
                          `第 ${a.page} 页选文：${a.text}\n批注：${a.comment}`,
                        )
                      }
                    >
                      <Sparkles size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      title="删除批注"
                      onClick={() =>
                        void api(`/annotations/${a.id}`, { method: "DELETE" })
                          .then(refresh)
                          .catch((e) => onError(e.message))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {["paper", "openreview"].includes(tab) && (
          <>
            <div className="analysis-intro">
              <div className="analysis-symbol">
                {tab === "paper" ? (
                  <Sparkles size={22} />
                ) : (
                  <MessagesSquare size={22} />
                )}
              </div>
              <h2>
                {tab === "paper" ? "读懂方法与创新" : "看见评审的共识与分歧"}
              </h2>
              <p>
                {tab === "paper"
                  ? "基于论文原文，梳理贡献、方法与实验依据。"
                  : "汇总公开审稿记录、AC 意见和最终决定。"}
              </p>
              <button
                className="primary"
                disabled={
                  live ||
                  (!!task &&
                    ["waiting_url", "waiting_selection"].includes(task.status))
                }
                onClick={() =>
                  void onTask(tab).catch((e) => onError(e.message))
                }
              >
                {analysis ? <RefreshCw size={15} /> : <Play size={15} />}{" "}
                {analysis
                  ? "重新分析"
                  : tab === "paper"
                    ? "分析论文"
                    : "分析 OpenReview"}
              </button>
              <small>Codex · gpt-6-luna · 点击后运行</small>
            </div>
            {task && (
              <div
                className={`task-state ${task.status === "failed" ? "failed" : ""}`}
              >
                <div>
                  <span className={live ? "pulse" : ""} />
                  <strong>{task.stage}</strong>
                </div>
                {task.error && <p>{task.error}</p>}
                <div className="task-actions">
                  {live ||
                  ["waiting_url", "waiting_selection"].includes(task.status) ? (
                    <button
                      className="text-btn"
                      onClick={() =>
                        void api(`/tasks/${task.id}/cancel`, { method: "POST" })
                          .then(refresh)
                          .catch((e) => onError(e.message))
                      }
                    >
                      <Square size={12} />
                      取消任务
                    </button>
                  ) : (
                    <button
                      className="text-btn"
                      onClick={() =>
                        void api(`/tasks/${task.id}/retry`, { method: "POST" })
                          .then(refresh)
                          .catch((e) => onError(e.message))
                      }
                    >
                      <RefreshCw size={12} />
                      重试
                    </button>
                  )}
                </div>
              </div>
            )}
            {tab === "openreview" && (
              <ReviewMaterial
                key={paper.id + (task?.id || "")}
                task={task?.status === "cancelled" ? undefined : task}
                paper={paper}
                onResume={resume}
                onSave={onSave}
              />
            )}
            {analysis ? (
              <>
                <div className="version-row">
                  <span>分析记录</span>
                  <select
                    aria-label="分析版本"
                    value={analysis.id}
                    onChange={(e) => {
                      setSelectedVersion(e.target.value);
                      setSnapshot(null);
                    }}
                  >
                    {relevant.map((a, i) => (
                      <option key={a.id} value={a.id}>
                        {i === 0 ? "最新 · " : ""}
                        {new Date(a.createdAt).toLocaleString("zh-CN")}
                      </option>
                    ))}
                  </select>
                </div>
                {analysis.score != null && (
                  <div className="analysis-score">
                    <span>AI 创新程度</span>
                    <strong>
                      {analysis.score}
                      <small>/ 5</small>
                    </strong>
                  </div>
                )}
                {analysis.source === "manual" && (
                  <div className="notice">
                    依据用户粘贴的材料分析，未独立核验完整审稿记录。
                  </div>
                )}
                <Markdown text={analysis.markdown} onPage={onPage} />
                {analysis.evidence?.length ? (
                  <details className="evidence">
                    <summary>
                      原文证据核查（
                      {analysis.evidence.filter((e) => e.verified).length}/
                      {analysis.evidence.length} 通过精确匹配）
                    </summary>
                    {analysis.evidence.map((e, i) => (
                      <div key={i}>
                        <button
                          className="page-link"
                          onClick={() => onPage(e.page)}
                        >
                          第 {e.page} 页
                        </button>
                        <span
                          className={e.verified ? "verified" : "error-text"}
                        >
                          {e.verified ? " · 已匹配原文" : " · 待核查"}
                        </span>
                        <p>{e.quote}</p>
                      </div>
                    ))}
                  </details>
                ) : null}
                {analysis.references?.length ? (
                  <details className="evidence">
                    <summary>审稿来源关联</summary>
                    {analysis.references.map((r, i) => (
                      <p key={i}>
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer">
                            {r.noteId}
                          </a>
                        ) : (
                          <span className="error-text">
                            未核实来源 {r.noteId}
                          </span>
                        )}{" "}
                        · {r.claim}
                      </p>
                    ))}
                  </details>
                ) : null}
                {analysis.snapshotId && (
                  <>
                    <button
                      className="secondary compact"
                      onClick={() =>
                        void api(`/snapshots/${analysis.snapshotId}`)
                          .then(setSnapshot)
                          .catch((e) => onError(e.message))
                      }
                    >
                      <FileText size={13} />
                      查看原始审稿快照
                    </button>
                    {snapshot && (
                      <details className="snapshot" open>
                        <summary>原始记录</summary>
                        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
                      </details>
                    )}
                  </>
                )}
                <p className="help">
                  {analysis.model} ·{" "}
                  {new Date(analysis.createdAt).toLocaleString("zh-CN")}
                  <br />
                  AI 判断仅基于可获得材料，请结合原文核查。
                </p>
              </>
            ) : (
              !task && (
                <div className="analysis-empty">
                  <FileText size={32} />
                  <p>分析结果和每次运行记录将保存在这里。</p>
                </div>
              )
            )}
          </>
        )}
      </div>
    </aside>
  );
}
