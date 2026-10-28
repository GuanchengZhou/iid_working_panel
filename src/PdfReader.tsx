import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./pdf-text.css";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Search,
  Highlighter,
  MessageSquare,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { api, type Paper, type Annotation } from "./types";
import PdfPage, { type PageLayout } from "./PdfPage";
GlobalWorkerOptions.workerSrc = workerUrl;
export type SelectedText = {
  text: string;
  page: number;
  rects: Annotation["rects"];
};
export default function PdfReader({
  paper,
  page,
  onPage,
  annotations,
  onAdd,
  onQuote,
  onPosition,
  pdfUrl,
  quoteLabel,
  onQuestion,
  pages,
}: {
  pages?: string[];
  pdfUrl?: string;
  quoteLabel?: string;
  onQuestion?: (s: SelectedText) => void;
  paper: Paper;
  page: number;
  onPage: (n: number) => void;
  annotations: Annotation[];
  onAdd: (s: SelectedText, comment: string, color: string) => Promise<void>;
  onQuote: (text: string) => void;
  onPosition: (patch: any) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPage, onPosition });
  callbacks.current = { onPage, onPosition };
  const reportedPage = useRef<number | null>(null),
    geometry = useRef(""),
    anchor = useRef({ page, fraction: 0 });
  const frame = useRef<number | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [width, setWidth] = useState(600),
    [bases, setBases] = useState<{ width: number; height: number }[]>([]),
    [zoom, setZoom] = useState(paper.zoom || 1),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<number[]>([]),
    [selection, setSelection] = useState<SelectedText | null>(null),
    [comment, setComment] = useState(""),
    [color, setColor] = useState("yellow"),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  useEffect(() => {
    const r = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    if (host.current) r.observe(host.current);
    return () => r.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    setError("");
    const load = getDocument({ url: pdfUrl || `/api/papers/${paper.id}/pdf` });
    load.promise
      .then((d) => {
        if (alive) setPdf(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      void load.destroy();
    };
  }, [paper.id, pdfUrl]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    (async () => {
      const sizes: { width: number; height: number }[] = new Array(
        pdf.numPages,
      );
      let next = 1;
      await Promise.all(
        Array.from({ length: Math.min(4, pdf.numPages) }, async () => {
          while (next <= pdf.numPages) {
            const n = next++;
            const page = await pdf.getPage(n);
            if (!alive) return;
            const view = page.getViewport({ scale: 1 });
            sizes[n - 1] = { width: view.width, height: view.height };
          }
        }),
      );
      if (alive) setBases(sizes);
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [pdf]);
  const layouts: PageLayout[] = bases.map((base) => {
    const scale = Math.max(0.25, (width - 52) / base.width) * zoom;
    return { scale, width: base.width * scale, height: base.height * scale };
  });
  const geometryKey = `${width}:${zoom}:${bases.length}`;
  useLayoutEffect(() => {
    const root = scroll.current;
    if (!root || !layouts.length) return;
    const target = root.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!target) return;
    const changed = geometry.current !== geometryKey;
    if (!changed && reportedPage.current === page) return;
    const fraction =
      changed && anchor.current.page === page ? anchor.current.fraction : 0;
    reportedPage.current = page;
    geometry.current = geometryKey;
    anchor.current = { page, fraction };
    root.scrollTo({
      top: Math.max(0, target.offsetTop - 24 + fraction * target.offsetHeight),
      behavior: "instant",
    });
    setSelection(null);
  }, [page, geometryKey]);
  function trackScroll() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const root = scroll.current;
      if (!root || !bases.length) return;
      const line =
        root.getBoundingClientRect().top +
        Math.min(root.clientHeight * 0.33, 180);
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-page]"),
      );
      const visible =
        nodes.find((node) => {
          const r = node.getBoundingClientRect();
          return r.top <= line && r.bottom > line;
        }) ||
        nodes.find((node) => node.getBoundingClientRect().top > line) ||
        nodes.at(-1);
      if (!visible) return;
      const n = Number(visible.dataset.page);
      anchor.current = {
        page: n,
        fraction: Math.max(
          0,
          Math.min(
            1,
            (root.scrollTop - visible.offsetTop + 24) / visible.offsetHeight,
          ),
        ),
      };
      if (reportedPage.current !== n) {
        reportedPage.current = n;
        callbacks.current.onPage(n);
      }
    });
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let live = true;
    (pages ? Promise.resolve(pages) : api<string[]>(`/papers/${paper.id}/pages`))
      .then((pages) => {
        if (live)
          setHits(
            pages
              .map((s, i) =>
                s
                  .replace(/\s+/g, " ")
                  .toLowerCase()
                  .includes(query.replace(/\s+/g, " ").toLowerCase())
                  ? i + 1
                  : 0,
              )
              .filter(Boolean),
          );
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [query, paper.id, pages]);
  const changeZoom = (v: number) => {
    setZoom(v);
    onPosition({ zoom: v });
  };
  return (
    <section className="reader" ref={host}>
      <div className="reader-toolbar">
        <div className="toolbar-group">
          <button
            className="icon-btn"
            title="上一页"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <input
            aria-label="页码"
            className="page-number"
            type="number"
            min="1"
            max={paper.pageCount}
            value={page}
            onChange={(e) =>
              onPage(
                Math.max(
                  1,
                  Math.min(paper.pageCount, Number(e.target.value) || 1),
                ),
              )
            }
          />
          <span className="muted">/ {paper.pageCount}</span>
          <button
            className="icon-btn"
            title="下一页"
            disabled={page >= paper.pageCount}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="toolbar-group zoom">
          <button
            className="icon-btn"
            title="缩小"
            disabled={zoom <= 0.5}
            onClick={() => changeZoom(Math.max(0.5, zoom - 0.1))}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-btn"
            title="放大"
            disabled={zoom >= 2}
            onClick={() => changeZoom(Math.min(2, zoom + 0.1))}
          >
            <Plus size={15} />
          </button>
        </div>
        <a
          className="icon-btn"
          href={pdfUrl || `/api/papers/${paper.id}/pdf`}
          target="_blank"
          title="独立打开 PDF"
        >
          <ExternalLink size={16} />
        </a>
      </div>
      <div className="pdf-search">
        <Search size={14} />
        <input
          placeholder="在论文中搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <>
            <span>{hits.length} 页匹配</span>
            <button
              disabled={!hits.length}
              onClick={() => onPage(hits.find((n) => n > page) || hits[0])}
            >
              下一个
            </button>
          </>
        )}
      </div>
      {!paper.hasText && (
        <div className="notice">
          此 PDF 无可提取文本，可阅读和添加页码笔记，暂不支持选文与 AI
          全文分析。
        </div>
      )}
      <div
        className="pdf-scroll pdf-continuous"
        ref={scroll}
        onScroll={trackScroll}
        aria-label="PDF 连续阅读区"
      >
        {error ? (
          <div className="error-box">{error}</div>
        ) : pdf && layouts.length ? (
          layouts.map((layout, i) => (
            <PdfPage
              key={i + 1}
              pdf={pdf}
              number={i + 1}
              layout={layout}
              root={scroll.current}
              annotations={annotations.filter((a) => a.page === i + 1)}
              query={query}
              onSelect={(s) => {
                setSelection(s);
                setSaveError("");
              }}
            />
          ))
        ) : (
          <div className="reader-loading">
            <LoaderCircle className="spin" size={18} />
            正在加载 PDF…
          </div>
        )}
      </div>
      {selection && (
        <div className="selection-card">
          <div className="selection-head">
            <Highlighter size={16} />
            <span>选中文本 · 第 {selection.page} 页</span>
            <button
              className="text-btn"
              onClick={() => {
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              取消
            </button>
          </div>
          <p>{selection.text.slice(0, 220)}</p>
          {saveError && <p className="error-text">{saveError}</p>}
          <input
            placeholder="添加批注（可选）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="selection-actions">
            <div className="colors">
              {["yellow", "green", "purple"].map((c) => (
                <button
                  aria-label={c}
                  key={c}
                  className={`color-dot ${c} ${color === c ? "chosen" : ""}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <button
              className="secondary compact"
              onClick={() => {
                if (onQuestion) { onQuestion(selection); setSelection(null); window.getSelection()?.removeAllRanges(); }
                else onQuote(`第 ${selection.page} 页选文：${selection.text}`);
              }}
            >
              <MessageSquare size={14} />{quoteLabel || "问 AI"}
            </button>
            <button
              className="primary compact"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onAdd(selection, comment, color);
                  setSelection(null);
                  setComment("");
                  window.getSelection()?.removeAllRanges();
                } catch (e: any) {
                  setSaveError(e.message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              保存高亮
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
