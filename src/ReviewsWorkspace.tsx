import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Upload,
  ArrowLeft,
  Play,
  Square,
  RefreshCw,
  Download,
  MessageSquare,
  FileText,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { api, type Paper, type Annotation } from "./types";
import PdfReader, { type SelectedText } from "./PdfReader";
import Markdown from "./Markdown";
import "./reviews.css";
const labels: Record<string, string> = {
  discover: "公开版本",
  analysis: "论文分析",
  initial: "初步审稿",
  typos: "typo 检查",
  compare: "版本比较",
  draft: "生成草稿",
  validate: "合理性检查",
  polish: "润色",
  chat: "审稿助手",
};
const stages: Record<string, string> = {
  unread: "待读",
  reviewing: "审阅中",
  drafted: "草稿完成",
  archived: "已归档",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
};
function IssueCard({ issue, onSave, onPage }: any) {
  const [content, setContent] = useState(issue.content),
    [editing, setEditing] = useState(false),
    [category, setCategory] = useState(issue.category),
    [importance, setImportance] = useState(issue.importance);
  return (
    <article className="rv-issue">
      <div className="rv-row">
        <span>
          {issue.kind === "global" ? (
            "全局问题"
          ) : (
            <button className="text-btn" onClick={() => onPage(issue.page)}>
              第 {issue.page} 页
            </button>
          )}
        </span>
        <small>
          {issue.importance === "major" ? "主要" : "次要"} · {issue.category}
        </small>
      </div>
      {issue.quote && <blockquote>{issue.quote}</blockquote>}
      {editing ? (
        <textarea
          aria-label="编辑问题内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      ) : (
        <Markdown text={issue.content} onPage={onPage} />
      )}
      {editing && (
        <div className="rv-row">
          <select
            aria-label="修改问题类别"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["方法", "理论", "实验", "相关工作", "表达", "其他"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="修改问题重要程度"
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
          >
            <option value="major">主要</option>
            <option value="minor">次要</option>
          </select>
        </div>
      )}
      <div className="rv-row">
        <select
          aria-label="问题状态"
          value={issue.status}
          onChange={(e) => onSave({ status: e.target.value })}
        >
          <option value="unverified">待核查</option>
          <option value="confirmed">已确认</option>
          <option value="resolved">已解决</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={issue.include}
            onChange={(e) => onSave({ include: e.target.checked })}
          />
          纳入审稿
        </label>
      </div>
      <div className="rv-row">
        <button
          className="text-btn"
          onClick={async () => {
            if (editing) await onSave({ content, category, importance });
            setEditing(!editing);
          }}
        >
          {editing ? "保存问题" : "编辑"}
        </button>
        <button className="text-btn" onClick={() => onSave({ removed: true })}>
          移除
        </button>
      </div>
    </article>
  );
}
function DraftEditor({ r, save, onDirty, flushRef, onPage }: any) {
  const [ss, setSections] = useState(r.draftSections),
    [preview, setPreview] = useState(false),
    [state, setState] = useState("已保存");
  const latest = useRef(ss),
    saved = useRef(JSON.stringify(ss)),
    revision = useRef(r.draftRevision),
    running = useRef<Promise<any> | null>(null);
  const saveFn = useRef(save);
  saveFn.current = save;
  const persist = useCallback(async () => {
    if (running.current) {
      await running.current;
    }
    const next = latest.current;
    if (JSON.stringify(next) === saved.current) return;
    setState("保存中…");
    const op = saveFn.current({
      expectedRevision: revision.current,
      sections: next,
    });
    running.current = op;
    try {
      const out = await op;
      revision.current = out.draftRevision;
      saved.current = JSON.stringify(next);
      setState(
        JSON.stringify(latest.current) === saved.current
          ? "已保存"
          : "等待保存",
      );
      onDirty(JSON.stringify(latest.current) !== saved.current);
    } catch (e: any) {
      setState("保存失败：" + e.message);
      throw e;
    } finally {
      running.current = null;
    }
  }, [onDirty]);
  flushRef.current = persist;
  useEffect(() => {
    latest.current = ss;
    onDirty(JSON.stringify(ss) !== saved.current);
    const t = setTimeout(() => void persist().catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [ss, persist, onDirty]);
  useEffect(() => {
    if (
      r.draftRevision !== revision.current &&
      JSON.stringify(latest.current) === saved.current &&
      !running.current
    ) {
      revision.current = r.draftRevision;
      saved.current = JSON.stringify(r.draftSections);
      latest.current = r.draftSections;
      setSections(r.draftSections);
    }
  }, [r.draftRevision, r.draftSections]);
  useEffect(
    () => () => {
      void persist().catch(() => {});
    },
    [persist],
  );
  const change = (i: number, p: any) =>
    setSections((old: any[]) =>
      old.map((s, j) => (j === i ? { ...s, ...p } : s)),
    );
  return (
    <div className="rv-draft">
      <div className="rv-row">
        <strong>正式审稿稿件</strong>
        <span>{state}</span>
      </div>
      <div className="rv-actions">
        <button
          className="secondary compact"
          onClick={() => setPreview(!preview)}
        >
          {preview ? "编辑" : "预览"}
        </button>
        <button
          className="secondary compact"
          onClick={() => void persist().catch(() => {})}
        >
          <Save size={13} />
          保存草稿
        </button>
        <button
          className="secondary compact"
          onClick={() =>
            setSections((old: any[]) => [
              ...old,
              { id: crypto.randomUUID(), heading: "New Section", content: "" },
            ])
          }
        >
          <Plus size={13} />
          新增章节
        </button>
      </div>
      {preview ? (
        <Markdown
          text={ss
            .map((s: any) => `## ${s.heading}\n\n${s.content}`)
            .join("\n\n")}
          onPage={onPage}
        />
      ) : (
        ss.map((s: any, i: number) => (
          <section className="rv-section" key={s.id}>
            <div className="rv-row">
              <input
                aria-label={`章节标题 ${i + 1}`}
                value={s.heading}
                onChange={(e) => change(i, { heading: e.target.value })}
              />
              <button
                title="上移章节"
                disabled={!i}
                onClick={() =>
                  setSections((old: any[]) => {
                    const a = [...old];
                    [a[i - 1], a[i]] = [a[i], a[i - 1]];
                    return a;
                  })
                }
              >
                <ChevronUp size={14} />
              </button>
              <button
                title="下移章节"
                disabled={i === ss.length - 1}
                onClick={() =>
                  setSections((old: any[]) => {
                    const a = [...old];
                    [a[i + 1], a[i]] = [a[i], a[i + 1]];
                    return a;
                  })
                }
              >
                <ChevronDown size={14} />
              </button>
              <button
                title="删除章节"
                disabled={ss.length === 1}
                onClick={() =>
                  setSections((old: any[]) => old.filter((x) => x.id !== s.id))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              aria-label={`${s.heading} 正文`}
              placeholder="写下你的审稿意见，或在 AI 候选结果中采用对应章节。"
              value={s.content}
              onChange={(e) => change(i, { content: e.target.value })}
            />
          </section>
        ))
      )}
    </div>
  );
}
function ReviewSettings({ r, templates, onSave }: any) {
  const [v, setV] = useState({ ...r });
  const set = (p: any) => setV((old: any) => ({ ...old, ...p }));
  const template = templates.find((x: any) => x.id === v.templateId);
  return (
    <form
      className="rv-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave({
          title: v.title,
          venue: v.venue,
          deadline: v.deadline,
          status: v.status,
          requirements: v.requirements,
          analysisLanguage: v.analysisLanguage,
          reviewLanguage: v.reviewLanguage,
          stepSettings: v.stepSettings,
          templateId: v.templateId,
          scoreScales: v.scoreScales,
          scores: v.scores,
          expectedSettingsRevision: r.settingsRevision,
        });
      }}
    >
      <label>
        论文标题
        <input
          value={v.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>
      <div className="rv-row">
        <label>
          会议／期刊
          <input
            value={v.venue}
            onChange={(e) => set({ venue: e.target.value })}
          />
        </label>
        <label>
          截止日期
          <input
            type="date"
            value={v.deadline}
            onChange={(e) => set({ deadline: e.target.value })}
          />
        </label>
      </div>
      <label>
        任务状态
        <select
          value={v.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          {["unread", "reviewing", "drafted", "archived"].map((s) => (
            <option key={s} value={s}>
              {stages[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        参考模板
        <select
          value={v.templateId}
          onChange={(e) => set({ templateId: e.target.value })}
        >
          {templates.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <small>
        根据你的 6_review
        历史文件提炼写法，不代表当前官方规范；更换模板不会覆盖已有章节。
      </small>
      <label>
        审稿要求
        <textarea
          value={v.requirements}
          onChange={(e) => set({ requirements: e.target.value })}
          placeholder="会议要求、关注方向、额外检查要求…"
        />
      </label>
      <div className="rv-row">
        {[
          ["analysisLanguage", "分析语言"],
          ["reviewLanguage", "审稿语言"],
        ].map(([key, name]) => (
          <label key={key}>
            {name}
            <select
              value={v[key]}
              onChange={(e) => set({ [key]: e.target.value })}
            >
              <option>中文</option>
              <option>English</option>
            </select>
          </label>
        ))}
      </div>
      <h3>分步骤 AI 设置</h3>
      {Object.entries(labels).map(([key, label]) => (
        <div className="rv-model" key={key}>
          <span>{label}</span>
          <select
            aria-label={`${label}模型`}
            value={v.stepSettings[key].model}
            onChange={(e) =>
              set({
                stepSettings: {
                  ...v.stepSettings,
                  [key]: { ...v.stepSettings[key], model: e.target.value },
                },
              })
            }
          >
            <option value="gpt-6-luna">6-luna</option>
            <option value="gpt-6.1-sol">6.1-sol</option>
          </select>
          <select
            aria-label={`${label}思考强度`}
            value={v.stepSettings[key].reasoningEffort}
            onChange={(e) =>
              set({
                stepSettings: {
                  ...v.stepSettings,
                  [key]: {
                    ...v.stepSettings[key],
                    reasoningEffort: e.target.value,
                  },
                },
              })
            }
          >
            {["low", "medium", "high", "xhigh", "max"].map((s, i) => (
              <option key={s} value={s}>
                {["低", "中", "高", "更高", "最高"][i]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <label>
        评分尺度（选填）
        <textarea
          value={v.scoreScales}
          onChange={(e) => set({ scoreScales: e.target.value })}
          placeholder="提供每个评分字段的范围和含义后，AI 才可建议数字。"
        />
      </label>
      {template?.scoreFields.map((f: string) => (
        <label key={f}>
          {f}
          <input
            value={v.scores[f] || ""}
            onChange={(e) =>
              set({ scores: { ...v.scores, [f]: e.target.value } })
            }
            placeholder="由你填写；AI 建议不自动采用"
          />
        </label>
      ))}
      <button className="primary" type="submit">
        <Save size={14} />
        保存设置
      </button>
    </form>
  );
}
export default function ReviewsWorkspace({
  onError,
}: {
  onError: (s: string) => void;
}) {
  const [list, setList] = useState<any[]>([]),
    [id, setId] = useState(localStorage.getItem("iid-review") || ""),
    [r, setR] = useState<any>(null),
    [templates, setTemplates] = useState<any[]>([]),
    [tab, setTab] = useState("analysis"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [selectedOutput, setSelectedOutput] = useState(""),
    [hidePdf, setHidePdf] = useState(false),
    [dirty, setDirty] = useState(false);
  const [issue, setIssue] = useState<any>(null),
    [issueText, setIssueText] = useState(""),
    [issueCategory, setIssueCategory] = useState("方法"),
    [importance, setImportance] = useState("major"),
    [message, setMessage] = useState(""),
    [publicURL, setPublicURL] = useState("");
  const versionFile = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null),
    flush = useRef<() => Promise<any>>(async () => {}),
    idRef = useRef(id);
  idRef.current = id;
  const load = useCallback(async () => {
    const [ls, ts] = await Promise.all([
      api("/reviews"),
      api("/reviews/templates"),
    ]);
    setList(ls);
    setTemplates(ts);
    const current = idRef.current;
    if (current) {
      const next = await api(`/reviews/${current}`);
      if (idRef.current === current) setR(next);
    }
  }, []);
  useEffect(() => {
    void load().catch((e) => onError(e.message));
    const s = new EventSource("/api/events");
    let t: ReturnType<typeof setTimeout>;
    s.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => void load().catch((e) => onError(e.message)), 200);
    };
    return () => {
      s.close();
      clearTimeout(t);
    };
  }, [load, onError]);
  useEffect(() => {
    localStorage.setItem("iid-review", id);
    setSelectedOutput("");
    setR(null);
    setIssue(null);
    if (id)
      void api(`/reviews/${id}`)
        .then((x) => {
          if (idRef.current === id) {
            setR(x);
            setPage(x.document.lastPage || 1);
          }
        })
        .catch((e) => {
          onError(e.message);
          setId("");
        });
  }, [id, onError]);
  useEffect(() => {
    const open = () => setTab("chat");
    window.addEventListener("iid-review-ai", open);
    return () => window.removeEventListener("iid-review-ai", open);
  }, []);
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const patch = async (p: any) => {
    const x = await api(`/reviews/${id}`, {
      method: "PATCH",
      body: JSON.stringify(p),
    });
    await load();
    return x;
  };
  const run = (step: string, extra: any = {}) =>
    act(async () => {
      await flush.current();
      const x = await api(`/reviews/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ step, ...extra }),
      });
      setSelectedOutput("");
      if (["draft", "validate", "polish"].includes(step)) setTab(step);
      await load();
      return x;
    });
  const addIssue = async () => {
    if (!issueText.trim()) return;
    await act(async () => {
      await api(`/reviews/${id}/issues`, {
        method: "POST",
        body: JSON.stringify({
          ...issue,
          content: issueText,
          category: issueCategory,
          importance,
        }),
      });
      setIssue(null);
      setIssueText("");
      await load();
    });
  };
  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    await act(async () => {
      const body = new FormData();
      for (const f of files) body.append("files", f);
      const results = await api("/reviews/import", { method: "POST", body });
      const errors = results.filter((x: any) => x.error);
      if (errors.length)
        onError(errors.map((x: any) => x.filename + "：" + x.error).join("\n"));
      await load();
      const first = results.find((x: any) => x.reviewId);
      if (first) {
        setId(first.reviewId);
        setTab("settings");
      }
    });
    if (file.current) file.current.value = "";
  };
  const pending = r?.tasks.find((t: any) =>
    ["queued", "running"].includes(t.status),
  );
  const outputs =
    r?.outputs.filter((o: any) => o.step === tab && !o.partial) || [];
  const output =
    outputs.find((o: any) => o.id === selectedOutput) || outputs[0];
  const stale =
    output &&
    (output.documentId !== r.documentId ||
      (["draft", "initial", "validate", "polish"].includes(output.step) &&
        output.input?.draftRevision !== r.draftRevision &&
        output.lastAppliedRevision !== r.draftRevision) ||
      (["draft", "validate"].includes(output.step) &&
        output.input?.issueRevision !== r.issueRevision));
  const go = (n: number) => {
    setPage(n);
    if (r)
      void api(`/reviews/${id}/documents/${r.documentId}/position`, {
        method: "PATCH",
        body: JSON.stringify({ lastPage: n }),
      }).catch((e) => onError(e.message));
  };
  const adopt = (out: any, sectionIds: string[]) =>
    act(async () => {
      await flush.current();
      const current = await api(`/reviews/${id}`);
      await api(`/reviews/${id}/outputs/${out.id}/adopt`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: current.draftRevision,
          sectionIds,
        }),
      });
      await load();
      setTab("draftEditor");
    });
  const confirmVersion = (url: string, outputId?: string) =>
    act(async () => {
      await api(`/reviews/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ url, outputId }),
      });
      await load();
      setTab("compare");
    });
  return (
    <div className="review-workspace">
      <input
        ref={file}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => void importFiles(e.target.files)}
      />
      <input
        ref={versionFile}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void act(async () => {
              const body = new FormData();
              body.append("sourceUrl", publicURL);
              body.append("file", f);
              await api(`/reviews/${id}/versions/upload`, {
                method: "POST",
                body,
              });
              await load();
              setTab("compare");
            });
          e.target.value = "";
        }}
      />
      {!id ? (
        <>
          <div className="rv-library-head">
            <div>
              <span className="eyebrow">REVIEW WORKSPACE</span>
              <h1>把质疑写清楚，让审稿有据可循。</h1>
              <p>阅读原文、记录问题、形成判断，审稿始终由你掌握。</p>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={16} />
              导入审稿 PDF
            </button>
          </div>
          <div className="rv-filters">
            <input
              aria-label="搜索审稿"
              placeholder="搜索论文、会议／期刊"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="审稿状态筛选"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">所有状态</option>
              {["unread", "reviewing", "drafted", "archived"].map((s) => (
                <option key={s} value={s}>
                  {stages[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="rv-cards">
            {list
              .filter(
                (x) =>
                  (filter === "all" || x.status === filter) &&
                  (x.title + " " + x.venue)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((x) => (
                <button
                  className="rv-card"
                  key={x.id}
                  onClick={() => {
                    setId(x.id);
                    setTab("analysis");
                  }}
                >
                  <div className="rv-row">
                    <FileText size={22} />
                    <span>{stages[x.status]}</span>
                  </div>
                  <h2>{x.title}</h2>
                  <p>
                    {x.venue || "会议／期刊待补充"} · {x.document.pageCount} 页
                  </p>
                  <p>
                    {x.deadline ? "截止 " + x.deadline : "未设置截止日期"} ·{" "}
                    {x.issueCount} 个待处理问题
                  </p>
                </button>
              ))}
          </div>
          {!list.length && (
            <div className="rv-empty">导入第一篇待审稿论文，开始你的审阅。</div>
          )}
        </>
      ) : !r ? (
        <p className="rv-empty">正在加载审稿材料…</p>
      ) : (
        <>
          <div className="rv-header">
            <button
              title="返回审稿列表"
              onClick={() =>
                void act(async () => {
                  await flush.current();
                  setId("");
                })
              }
            >
              <ArrowLeft size={19} />
            </button>
            <div>
              <span className="eyebrow">
                REVIEWING ROOM · {stages[r.status]}
              </span>
              <h1 title={r.title}>{r.title}</h1>
            </div>
            <button
              className="secondary compact"
              onClick={() => setHidePdf(!hidePdf)}
            >
              {hidePdf ? "显示 PDF" : "展开工作区"}
            </button>
            <button
              className="primary compact"
              disabled={busy || !!pending}
              onClick={() => void run("all")}
            >
              一键初审
            </button>
          </div>
          <div className="rv-layout">
            {!hidePdf && (
              <PdfReader
                key={r.documentId}
                paper={
                  {
                    ...r.document,
                    hasText: r.document.pages.some((x: string) => x.trim()),
                  } as Paper
                }
                pages={r.document.pages}
                pdfUrl={`/api/reviews/${id}/documents/${r.documentId}/pdf`}
                quoteLabel="添加问题"
                onQuestion={(s: SelectedText) => {
                  setIssue({
                    kind: "location",
                    page: s.page,
                    quote: s.text,
                    rects: s.rects,
                  });
                  setIssueText("");
                  setTab("issues");
                }}
                page={page}
                onPage={go}
                annotations={
                  [
                    ...r.annotations.filter(
                      (a: any) => !a.removed && a.documentId === r.documentId,
                    ),
                    ...r.issues
                      .filter(
                        (i: any) =>
                          i.documentId === r.documentId &&
                          i.kind === "location" &&
                          i.rects?.length,
                      )
                      .map((i: any) => ({
                        ...i,
                        text: i.quote,
                        color: "purple",
                        comment: i.content,
                      })),
                  ] as Annotation[]
                }
                onAdd={async (s, c, color) => {
                  await api(`/reviews/${id}/annotations`, {
                    method: "POST",
                    body: JSON.stringify({ ...s, comment: c, color }),
                  });
                  await load();
                }}
                onQuote={(text) => {
                  setIssue({ kind: "location", page, quote: text, rects: [] });
                  setTab("issues");
                }}
                onPosition={(p) =>
                  void api(
                    `/reviews/${id}/documents/${r.documentId}/position`,
                    { method: "PATCH", body: JSON.stringify(p) },
                  ).catch((e) => onError(e.message))
                }
              />
            )}
            <aside className={`rv-panel ${hidePdf ? "rv-wide" : ""}`}>
              <nav className="rv-tabs">
                {[
                  ["analysis", "分析"],
                  ["issues", "问题备忘"],
                  ["draftEditor", "审稿草稿"],
                  ["draft", "草稿候选"],
                  ["discover", "公开版本"],
                  ["typos", "typo"],
                  ["initial", "AI 初审"],
                  ["validate", "合理性"],
                  ["polish", "润色"],
                  ["compare", "版本比较"],
                  ["chat", "助手"],
                  ["settings", "设置"],
                ].map(([k, v]) => (
                  <button
                    className={tab === k ? "active" : ""}
                    key={k}
                    onClick={() => {
                      setTab(k);
                      setSelectedOutput("");
                    }}
                  >
                    {v}
                  </button>
                ))}
              </nav>
              <div className="rv-panel-body">
                {busy && (
                  <div className="rv-task">
                    正在处理请求；公开稿下载可能需要一些时间…
                  </div>
                )}
                {pending && (
                  <div className="rv-task">
                    <strong>{pending.stage}</strong>
                    <small>
                      {pending.activeModel || pending.model} ·{" "}
                      {pending.activeReasoningEffort || pending.reasoningEffort}
                    </small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(`/tasks/${pending.id}/cancel`, {
                            method: "POST",
                          });
                          await load();
                        })
                      }
                    >
                      <Square size={12} />
                      停止
                    </button>
                  </div>
                )}
                {r.tasks
                  .filter((t: any) =>
                    ["failed", "interrupted"].includes(t.status),
                  )
                  .slice(0, 1)
                  .map((t: any) => (
                    <div className="rv-warning" key={t.id}>
                      {t.stage}：{t.error}
                      <button
                        onClick={() =>
                          void act(async () => {
                            await api(`/tasks/${t.id}/retry`, {
                              method: "POST",
                            });
                            await load();
                          })
                        }
                      >
                        重试
                      </button>
                    </div>
                  ))}
                {tab === "settings" ? (
                  <ReviewSettings
                    key={id}
                    r={r}
                    templates={templates}
                    onSave={(p: any) =>
                      act(async () => {
                        await patch(p);
                        onError("审稿设置已保存");
                      })
                    }
                  />
                ) : tab === "issues" ? (
                  <>
                    <div className="rv-actions">
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setIssue({ kind: "global", quote: "", rects: [] });
                          setIssueText("");
                        }}
                      >
                        新增全局问题
                      </button>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setIssue({
                            kind: "location",
                            page,
                            quote: "",
                            rects: [],
                          });
                          setIssueText("");
                        }}
                      >
                        当前页问题
                      </button>
                    </div>
                    {issue && (
                      <div className="rv-issue-form">
                        <h3>
                          {issue.kind === "global"
                            ? "全局问题"
                            : `第 ${issue.page} 页的问题`}
                        </h3>
                        {issue.quote && <blockquote>{issue.quote}</blockquote>}
                        <textarea
                          aria-label="新问题内容"
                          placeholder="写下你的质疑、需要核查的论点或希望作者澄清的问题…"
                          value={issueText}
                          onChange={(e) => setIssueText(e.target.value)}
                        />
                        <div className="rv-row">
                          <select
                            value={issueCategory}
                            onChange={(e) => setIssueCategory(e.target.value)}
                          >
                            {[
                              "方法",
                              "理论",
                              "实验",
                              "相关工作",
                              "表达",
                              "其他",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <select
                            value={importance}
                            onChange={(e) => setImportance(e.target.value)}
                          >
                            <option value="major">主要问题</option>
                            <option value="minor">次要问题</option>
                          </select>
                        </div>
                        <div className="rv-actions">
                          <button
                            className="primary compact"
                            disabled={busy || !issueText.trim()}
                            onClick={() => void addIssue()}
                          >
                            保存问题
                          </button>
                          <button
                            className="text-btn"
                            onClick={() => setIssue(null)}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                    {r.issues.map((x: any) => (
                      <IssueCard
                        key={x.id}
                        issue={x}
                        onPage={go}
                        onSave={(p: any) =>
                          act(async () => {
                            await api(`/reviews/${id}/issues/${x.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                ...p,
                                expectedUpdatedAt: x.updatedAt,
                              }),
                            });
                            await load();
                          })
                        }
                      />
                    ))}
                    <h3>阅读批注</h3>
                    {r.annotations
                      .filter((a: any) => !a.removed)
                      .map((a: any) => (
                        <article className="rv-issue" key={a.id}>
                          <button
                            className="text-btn"
                            onClick={() => go(a.page)}
                          >
                            第 {a.page} 页
                          </button>
                          <blockquote>{a.text}</blockquote>
                          <textarea
                            aria-label="编辑批注"
                            defaultValue={a.comment}
                            onBlur={(e) => {
                              if (e.target.value !== a.comment)
                                void act(async () => {
                                  await api(
                                    `/reviews/${id}/annotations/${a.id}`,
                                    {
                                      method: "PATCH",
                                      body: JSON.stringify({
                                        comment: e.target.value,
                                      }),
                                    },
                                  );
                                  await load();
                                });
                            }}
                          />
                          <div className="rv-row">
                            <select
                              aria-label="批注颜色"
                              value={a.color}
                              onChange={(e) =>
                                void act(async () => {
                                  await api(
                                    `/reviews/${id}/annotations/${a.id}`,
                                    {
                                      method: "PATCH",
                                      body: JSON.stringify({
                                        color: e.target.value,
                                      }),
                                    },
                                  );
                                  await load();
                                })
                              }
                            >
                              {["yellow", "green", "purple"].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                            <button
                              onClick={() =>
                                void act(async () => {
                                  await api(
                                    `/reviews/${id}/annotations/${a.id}`,
                                    {
                                      method: "PATCH",
                                      body: JSON.stringify({ removed: true }),
                                    },
                                  );
                                  await load();
                                })
                              }
                            >
                              移除批注
                            </button>
                          </div>
                        </article>
                      ))}
                  </>
                ) : tab === "draftEditor" ? (
                  <>
                    <div className="rv-actions">
                      <button
                        className="primary compact"
                        disabled={busy || !!pending}
                        onClick={() => void run("draft")}
                      >
                        根据问题生成草稿
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy || !!pending}
                        onClick={() => void run("validate")}
                      >
                        合理性检查
                      </button>
                      <button
                        className="secondary compact"
                        disabled={busy || !!pending}
                        onClick={() => void run("polish")}
                      >
                        润色
                      </button>
                      <button
                        className="secondary compact"
                        onClick={() =>
                          void act(async () => {
                            await flush.current();
                            window.location.assign(`/api/reviews/${id}/export`);
                          })
                        }
                      >
                        <Download size={13} />
                        导出 .md
                      </button>
                      <button
                        className="secondary compact"
                        onClick={() =>
                          void act(async () => {
                            await flush.current();
                            const current = await api(`/reviews/${id}`);
                            await navigator.clipboard.writeText(
                              current.draftSections
                                .map(
                                  (s: any) => `## ${s.heading}\n\n${s.content}`,
                                )
                                .join("\n\n"),
                            );
                            onError("已复制 Markdown");
                          })
                        }
                      >
                        复制
                      </button>
                    </div>
                    <DraftEditor
                      r={r}
                      key={id}
                      onDirty={setDirty}
                      flushRef={flush}
                      onPage={go}
                      save={async (b: any) => {
                        const out = await api(`/reviews/${id}/draft`, {
                          method: "PUT",
                          body: JSON.stringify(b),
                        });
                        void load();
                        return out;
                      }}
                    />
                    <details>
                      <summary>草稿历史（{r.history.length}）</summary>
                      {r.history.map((h: any) => (
                        <div className="rv-history" key={h.id}>
                          <span>
                            {new Date(h.createdAt).toLocaleString()} · v
                            {h.revision}
                          </span>
                          <button
                            onClick={() =>
                              void act(async () => {
                                await flush.current();
                                const current = await api(`/reviews/${id}`);
                                await api(
                                  `/reviews/${id}/history/${h.id}/restore`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      expectedRevision: current.draftRevision,
                                    }),
                                  },
                                );
                                await load();
                              })
                            }
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                    </details>
                  </>
                ) : tab === "chat" ? (
                  <>
                    <h3>审稿助手</h3>
                    <small>
                      使用当前论文、已选问题、分析与草稿回答；会话独立保存。
                    </small>
                    {r.outputs
                      .filter((o: any) => o.step === "chat")
                      .slice()
                      .reverse()
                      .map((o: any) => (
                        <div className="rv-chat" key={o.id}>
                          <strong>你</strong>
                          <p>{o.userMessage}</p>
                          <small>
                            {o.model} · {o.reasoningEffort}
                          </small>
                          <Markdown text={o.markdown} onPage={go} />
                        </div>
                      ))}
                    <textarea
                      aria-label="审稿助手消息"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="例如：这条理论质疑是否已经被附录回答？"
                    />
                    <button
                      className="primary compact"
                      disabled={busy || !!pending || !message.trim()}
                      onClick={() =>
                        void run("chat", { message }).then((x) => {
                          if (x) setMessage("");
                        })
                      }
                    >
                      <MessageSquare size={13} />
                      发送
                    </button>
                  </>
                ) : (
                  <>
                    <div className="rv-row">
                      <h2>{labels[tab]}</h2>
                      <button
                        className="primary compact"
                        disabled={busy || !!pending || tab === "compare"}
                        onClick={() => void run(tab)}
                      >
                        <Play size={13} />
                        {output ? "重新运行" : "开始"}
                      </button>
                    </div>
                    <div className="rv-model">
                      <span>本步模型</span>
                      <select
                        aria-label="本步模型"
                        value={r.stepSettings[tab]?.model || "gpt-6-luna"}
                        onChange={(e) =>
                          void act(() =>
                            patch({
                              stepSettings: {
                                ...r.stepSettings,
                                [tab]: {
                                  ...r.stepSettings[tab],
                                  model: e.target.value,
                                },
                              },
                            }),
                          )
                        }
                      >
                        <option value="gpt-6-luna">6-luna</option>
                        <option value="gpt-6.1-sol">6.1-sol</option>
                      </select>
                      <select
                        aria-label="本步思考强度"
                        value={r.stepSettings[tab]?.reasoningEffort || "medium"}
                        onChange={(e) =>
                          void act(() =>
                            patch({
                              stepSettings: {
                                ...r.stepSettings,
                                [tab]: {
                                  ...r.stepSettings[tab],
                                  reasoningEffort: e.target.value,
                                },
                              },
                            }),
                          )
                        }
                      >
                        {["low", "medium", "high", "xhigh", "max"].map(
                          (s, i) => (
                            <option key={s} value={s}>
                              {["低", "中", "高", "更高", "最高"][i]}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    {outputs.length > 0 && (
                      <select
                        className="rv-full"
                        aria-label="结果历史"
                        value={output?.id}
                        onChange={(e) => setSelectedOutput(e.target.value)}
                      >
                        {outputs.map((o: any) => (
                          <option key={o.id} value={o.id}>
                            {new Date(o.createdAt).toLocaleString()} · {o.model}
                          </option>
                        ))}
                      </select>
                    )}
                    {stale && (
                      <div className="rv-warning">
                        此结果基于旧稿件、问题或草稿；采用前请重新生成。内容仍可查看。
                      </div>
                    )}
                    {output ? (
                      <>
                        <small>
                          {output.model} · {output.reasoningEffort} ·{" "}
                          {new Date(output.createdAt).toLocaleString()}
                        </small>
                        <Markdown text={output.markdown} onPage={go} />
                        {output.sections?.length > 0 && (
                          <div className="rv-candidate">
                            <div className="rv-row">
                              <h3>候选稿对照</h3>
                              <button
                                disabled={busy || dirty || stale}
                                onClick={() =>
                                  void adopt(
                                    output,
                                    output.sections.map((s: any) => s.id),
                                  )
                                }
                              >
                                采用全部章节
                              </button>
                            </div>
                            {output.sections.map((s: any) => (
                              <section key={s.id}>
                                <h3>{s.heading}</h3>
                                <details>
                                  <summary>查看当前章节</summary>
                                  <Markdown
                                    text={
                                      r.draftSections.find(
                                        (x: any) => x.id === s.id,
                                      )?.content || "当前为空"
                                    }
                                    onPage={go}
                                  />
                                </details>
                                <Markdown text={s.content} onPage={go} />
                                <button
                                  className="secondary compact"
                                  disabled={busy || dirty || stale}
                                  onClick={() => void adopt(output, [s.id])}
                                >
                                  采用此章节
                                </button>
                              </section>
                            ))}
                          </div>
                        )}
                        {output.findings?.length > 0 && (
                          <div>
                            <h3>问题清单（{output.findings.length}）</h3>
                            {output.findings.map((f: any, i: number) => (
                              <article className="rv-issue" key={i}>
                                <div className="rv-row">
                                  <button onClick={() => go(f.page)}>
                                    第 {f.page} 页
                                  </button>
                                  <small>
                                    {f.category} · {f.confidence}
                                  </small>
                                </div>
                                <blockquote>{f.quote}</blockquote>
                                <p>{f.explanation}</p>
                                <p>建议：{f.suggestion}</p>
                                <small>
                                  {f.verified
                                    ? "原文匹配通过"
                                    : "原文未精确匹配 · 待核查"}
                                </small>
                                <button
                                  className="text-btn"
                                  onClick={() => {
                                    setIssue({
                                      kind: "location",
                                      page: f.page,
                                      quote: f.quote,
                                      rects: [],
                                      outputId: output.id,
                                    });
                                    setIssueText(
                                      f.explanation +
                                        "\n\n建议：" +
                                        f.suggestion,
                                    );
                                    setTab("issues");
                                  }}
                                >
                                  转为问题备忘
                                </button>
                              </article>
                            ))}
                          </div>
                        )}
                        {output.evidence?.length > 0 && (
                          <details>
                            <summary>原文依据核查</summary>
                            {output.evidence.map((e: any, i: number) => (
                              <p key={i}>
                                <button
                                  className="text-btn"
                                  onClick={() => go(e.page)}
                                >
                                  第 {e.page} 页
                                </button>{" "}
                                {e.verified ? "✓" : "待核查"} {e.quote}
                              </p>
                            ))}
                          </details>
                        )}
                        {output.candidates?.map((c: any, i: number) => (
                          <article className="rv-issue" key={i}>
                            <h3>{c.title}</h3>
                            <a href={c.url} target="_blank" rel="noreferrer">
                              公开页面
                            </a>
                            <p>
                              {c.date} · {c.confidence}
                            </p>
                            <p>{c.reason}</p>
                            <button
                              className="secondary compact"
                              disabled={busy || !!pending}
                              onClick={() =>
                                void confirmVersion(c.url, output.id)
                              }
                            >
                              确认关联并比较
                            </button>
                          </article>
                        ))}
                      </>
                    ) : (
                      <div className="rv-empty">
                        尚无{labels[tab]}
                        结果。选择模型后运行，或先在设置中配置并点击“一键初审”。
                      </div>
                    )}
                    {tab === "typos" &&
                      !output &&
                      r.outputs
                        .filter((o: any) => o.step === "typos" && o.partial)
                        .map((o: any) => (
                          <details key={o.id}>
                            <summary>
                              已保存：第{o.coverage.start}–{o.coverage.end}页
                            </summary>
                            <Markdown text={o.markdown} onPage={go} />
                          </details>
                        ))}
                    {tab === "discover" && (
                      <div className="rv-issue">
                        <h3>补充公开版本网址</h3>
                        {r.versionImportError && (
                          <p className="rv-warning">
                            上次下载未完成：{r.versionImportError}
                          </p>
                        )}
                        <input
                          aria-label="公开版本网址"
                          placeholder={
                            r.pendingVersionUrl ||
                            "https://arxiv.org/abs/… 或 OpenReview forum"
                          }
                          value={publicURL}
                          onChange={(e) => setPublicURL(e.target.value)}
                        />
                        <button
                          className="secondary compact"
                          disabled={busy || !!pending || !publicURL}
                          onClick={() => void confirmVersion(publicURL)}
                        >
                          确认网址并比较
                        </button>
                        <button
                          className="secondary compact"
                          disabled={busy || !!pending}
                          onClick={() => versionFile.current?.click()}
                        >
                          上传已下载的公开版本 PDF
                        </button>
                      </div>
                    )}
                    {tab === "compare" &&
                      r.documents
                        .filter((d: any) => d.id !== r.documentId)
                        .map((d: any) => (
                          <article className="rv-issue" key={d.id}>
                            <h3>{d.title}</h3>
                            <a
                              href={`/api/reviews/${id}/documents/${d.id}/pdf`}
                              target="_blank"
                            >
                              查看公开稿 PDF
                            </a>
                            <p>{d.sourceUrl}</p>
                            <button
                              disabled={busy || !!pending}
                              onClick={() =>
                                void run("compare", { comparisonId: d.id })
                              }
                            >
                              重新比较
                            </button>
                          </article>
                        ))}
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
