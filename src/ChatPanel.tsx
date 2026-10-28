import { useEffect, useState, useRef } from "react";
import {
  X,
  Plus,
  Send,
  Square,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import {
  api,
  type Chat,
  type Message,
  type Paper,
  type Task,
  type Analysis,
} from "./types";
import Markdown from "./Markdown";
import AssistantControls from "./AssistantControls";
export default function ChatPanel({
  paper,
  chats,
  tasks,
  analyses,
  quote,
  onClearQuote,
  onClose,
  refresh,
  onPage,
  onError,
}: {
  paper?: Paper;
  chats: Chat[];
  tasks: Task[];
  analyses: Analysis[];
  quote: string;
  onClearQuote: () => void;
  onClose: () => void;
  refresh: () => Promise<void>;
  onPage: (n: number) => void;
  onError: (s: string) => void;
}) {
  const [chatId, setChatId] = useState(""),
    [scope, setScope] = useState(paper ? "paper" : "global"),
    [input, setInput] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [attachNote, setAttachNote] = useState(false),
    [attachAnalysis, setAttachAnalysis] = useState(false),
    [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(
      Number(localStorage.getItem("iid-chat-width")) || 460,
    );
  const filtered = chats.filter((c) =>
    scope === "paper" && paper ? c.paperId === paper.id : !c.paperId,
  );
  const chat = chats.find((c) => c.id === chatId),
    active = tasks.find(
      (t) => t.chatId === chatId && ["queued", "running"].includes(t.status),
    ),
    latestTask = tasks.find((t) => t.chatId === chatId),
    failure =
      latestTask &&
      ["failed", "interrupted", "cancelled"].includes(latestTask.status)
        ? latestTask
        : undefined;
  useEffect(() => {
    if (!paper && scope === "paper") setScope("global");
  }, [paper?.id, scope]);
  useEffect(() => {
    if (quote && paper) setScope("paper");
  }, [quote, paper?.id]);
  useEffect(() => {
    setChatId(filtered[0]?.id || "");
  }, [scope, paper?.id]);
  useEffect(() => {
    let alive = true;
    if (!chatId) {
      setMessages([]);
      return;
    }
    api<Message[]>(`/chats/${chatId}/messages`)
      .then((m) => {
        if (alive) setMessages(m);
      })
      .catch((e) => onError(e.message));
    return () => {
      alive = false;
    };
  }, [chatId, tasks]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, active?.output]);
  async function create() {
    const c = await api<Chat>("/chats", {
      method: "POST",
      body: JSON.stringify({
        paperId: scope === "paper" ? paper?.id : undefined,
      }),
    });
    await refresh();
    setChatId(c.id);
    return c.id;
  }
  async function send() {
    if (!input.trim() || busy || active) return;
    setBusy(true);
    try {
      const id = chatId || (await create());
      const selected = chat?.paperId
        ? paper
        : scope === "paper"
          ? paper
          : undefined;
      const attachments = [
        quote,
        attachNote && selected ? `文献笔记：\n${selected.note}` : "",
        attachAnalysis
          ? analyses
              .filter((a) => a.paperId === selected?.id)
              .filter(
                (a, i, ar) => ar.findIndex((b) => b.type === a.type) === i,
              )
              .map((a) => a.markdown)
              .join("\n\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await api(`/chats/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: input, attachments }),
      });
      setInput("");
      onClearQuote();
      await refresh();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function resize(e: React.PointerEvent) {
    e.preventDefault();
    const start = e.clientX,
      w = width;
    function move(ev: PointerEvent) {
      setWidth(
        Math.max(360, Math.min(window.innerWidth - 80, w + start - ev.clientX)),
      );
    }
    function end() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
  }
  useEffect(() => {
    localStorage.setItem("iid-chat-width", String(width));
  }, [width]);
  return (
    <aside
      className="chat-panel"
      style={{ width: Math.min(width, window.innerWidth) }}
    >
      <div className="resize-handle" onPointerDown={resize} />
      <header className="chat-header">
        <div className="ai-emblem">
          <Sparkles size={18} />
        </div>
        <div>
          <strong>科研助手</strong>
          <small>Codex · 模型可选</small>
        </div>
        <button className="icon-btn" title="收起 AI" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <AssistantControls onError={onError} />
      <div className="chat-controls">
        <div className="segmented">
          <button
            className={scope === "paper" ? "active" : ""}
            disabled={!paper}
            onClick={() => setScope("paper")}
          >
            当前文献
          </button>
          <button
            className={scope === "global" ? "active" : ""}
            onClick={() => setScope("global")}
          >
            通用会话
          </button>
        </div>
        <div className="chat-picker">
          <select
            aria-label="历史会话"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          >
            <option value="">新会话</option>
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title="新建会话"
            onClick={() => void create().catch((e) => onError(e.message))}
          >
            <Plus size={18} />
          </button>
        </div>
        {scope === "paper" && paper && (
          <div className="context-label">
            <Paperclip size={12} />
            <span>{paper.title}</span>
            <span>全文已关联</span>
          </div>
        )}
      </div>
      <div className="chat-messages">
        {!messages.length && !active && (
          <div className="chat-welcome">
            <div className="welcome-symbol">
              <Sparkles size={30} />
            </div>
            <h2>让阅读多一个视角</h2>
            <p>梳理方法、追问公式，或一起推敲论文的创新之处。</p>
            {[
              "用直观的语言解释这篇论文的方法",
              "这篇论文和已有方法有什么关键区别？",
              "有哪些实验还不足以支持作者的结论？",
            ].map((t) => (
              <button key={t} onClick={() => setInput(t)}>
                {t}
                <ChevronDown size={14} />
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div className={`message ${m.role}`} key={m.id}>
            <div className="message-label">
              {m.role === "user" ? "你" : "IID 助手"}
              <time>
                {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            {m.attachments && (
              <details className="attachment-detail">
                <summary>附加材料</summary>
                <pre>{m.attachments}</pre>
              </details>
            )}
            <Markdown text={m.content} onPage={onPage} />
          </div>
        ))}
        {active && (
          <div className="message assistant">
            <div className="message-label">
              <span className="pulse" />
              {active.stage}
            </div>
            {active.output ? (
              <Markdown text={active.output} onPage={onPage} />
            ) : (
              <div className="typing">● ● ●</div>
            )}
          </div>
        )}
        {failure && !active && (
          <div className="error-box">
            {failure.error || "任务已取消"}
            <button
              className="text-btn"
              onClick={() =>
                void api(`/tasks/${failure.id}/retry`, { method: "POST" })
                  .then(refresh)
                  .catch((e) => onError(e.message))
              }
            >
              <RefreshCw size={13} />
              重试回复
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="chat-compose">
        {quote && (
          <div className="quote-chip">
            <Paperclip size={13} />
            <span>{quote.slice(0, 100)}</span>
            <button onClick={onClearQuote}>
              <X size={13} />
            </button>
          </div>
        )}
        {scope === "paper" && paper && (
          <div className="attach-options">
            <label>
              <input
                type="checkbox"
                checked={attachNote}
                onChange={(e) => setAttachNote(e.target.checked)}
              />
              附加笔记
            </label>
            <label>
              <input
                type="checkbox"
                checked={attachAnalysis}
                onChange={(e) => setAttachAnalysis(e.target.checked)}
              />
              附加分析
            </label>
          </div>
        )}
        <div className="compose-box">
          <textarea
            aria-label="AI 问题"
            placeholder="输入问题，Shift + Enter 换行…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="compose-bottom">
            <span>会话自动保存在本机</span>
            {active ? (
              <button
                className="send-btn stop"
                title="停止生成"
                onClick={() =>
                  void api(`/tasks/${active.id}/cancel`, { method: "POST" })
                    .then(refresh)
                    .catch((e) => onError(e.message))
                }
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="send-btn"
                title="发送问题"
                disabled={!input.trim() || busy}
                onClick={() => void send()}
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </div>
        <p className="chat-footnote">
          AI 可能出错，请结合原文核查。论文内容将发送至 Codex。
        </p>
      </div>
    </aside>
  );
}
