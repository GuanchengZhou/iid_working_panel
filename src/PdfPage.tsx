import { useEffect, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import { LoaderCircle } from "lucide-react";
import type { Annotation } from "./types";
import type { SelectedText } from "./PdfReader";
export type PageLayout = { width: number; height: number; scale: number };

/** Keep every page in the scroll layout, but render only pages near the viewport. */
export default function PdfPage({
  pdf,
  number,
  layout,
  root,
  annotations,
  query,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  layout: PageLayout;
  root: HTMLDivElement | null;
  annotations: Annotation[];
  query: string;
  onSelect: (s: SelectedText) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (!wrap.current || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root, rootMargin: "900px 0px" },
    );
    observer.observe(wrap.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near) return;
    let cancelled = false,
      render:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined,
      layer: TextLayer | undefined;
    const cv = canvas.current!,
      container = text.current!;
    setLoading(true);
    setError("");
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: layout.scale }),
        ratio = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(viewport.width * ratio);
      cv.height = Math.floor(viewport.height * ratio);
      cv.style.width = viewport.width + "px";
      cv.style.height = viewport.height + "px";
      render = page.render({
        canvas: cv,
        canvasContext: cv.getContext("2d")!,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (cancelled) return;
      const content = await page.getTextContent();
      if (cancelled) return;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(viewport.scale));
      container.style.setProperty(
        "--total-scale-factor",
        String(viewport.scale),
      );
      container.style.setProperty("--user-unit", "1");
      layer = new TextLayer({
        textContentSource: content,
        container,
        viewport,
      });
      await layer.render();
      if (!cancelled) setLoading(false);
    })().catch((e) => {
      if (!cancelled && e.name !== "RenderingCancelledException") {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, number, layout.scale, near]);
  useEffect(() => {
    text.current
      ?.querySelectorAll("span")
      .forEach((span) =>
        span.classList.toggle(
          "search-match",
          !!query.trim() &&
            !!span.textContent?.toLowerCase().includes(query.toLowerCase()),
        ),
      );
  }, [query, loading, near]);
  function select() {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !text.current?.contains(selection.anchorNode) ||
      !text.current?.contains(selection.focusNode)
    )
      return;
    const box = wrap.current!.getBoundingClientRect();
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => {
        const x = Math.max(0, (r.left - box.left) / box.width),
          y = Math.max(0, (r.top - box.top) / box.height);
        return {
          x,
          y,
          width: Math.max(0, Math.min(1 - x, r.width / box.width)),
          height: Math.max(0, Math.min(1 - y, r.height / box.height)),
        };
      })
      .filter((r) => r.width > 0 && r.height > 0);
    if (rects.length)
      onSelect({ text: selection.toString(), page: number, rects });
  }
  return (
    <div
      className="pdf-page-frame"
      data-page={number}
      role="group"
      aria-label={`PDF 第 ${number} 页`}
    >
      <div
        className="pdf-page"
        ref={wrap}
        style={{ width: layout.width, height: layout.height }}
        onMouseUp={select}
      >
        {near && (
          <>
            <canvas key={layout.scale} ref={canvas} />
            <div className="textLayer" ref={text} />
          </>
        )}
        <div className="highlight-layer">
          {annotations.flatMap((a) =>
            a.rects.map((r, i) => (
              <span
                title={a.comment || a.text}
                key={a.id + i}
                className={`highlight ${a.color}`}
                style={{
                  left: r.x * 100 + "%",
                  top: r.y * 100 + "%",
                  width: r.width * 100 + "%",
                  height: r.height * 100 + "%",
                }}
              />
            )),
          )}
        </div>
        {error ? (
          <div className="error-box">
            第 {number} 页加载失败：{error}
          </div>
        ) : (
          (!near || loading) && (
            <div className="pdf-loading">
              {near && <LoaderCircle className="spin" size={16} />}第 {number}{" "}
              页{near ? " · 加载中…" : ""}
            </div>
          )
        )}
      </div>
      <div className="pdf-page-caption">
        {number} / {pdf.numPages}
      </div>
    </div>
  );
}
