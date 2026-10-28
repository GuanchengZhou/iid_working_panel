import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { normalizeMath } from "./math-markdown";
export default function Markdown({
  text,
  onPage,
  onMaterial,
}: {
  text: string;
  onMaterial?: (id: string) => void;
  onPage?: (p: number) => void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, trust: false }]]}
        urlTransform={(url) =>
          url.startsWith("paper-page:") || url.startsWith("material:")
            ? url
            : /^(https?:|mailto:|#)/i.test(url)
              ? url
              : ""
        }
        components={{
          a: ({ href, children }) =>
            href?.startsWith("material:") ? (
              <button
                className="page-link"
                onClick={() => onMaterial?.(href.slice(9))}
              >
                {children}
              </button>
            ) : href?.startsWith("paper-page:") ? (
              <button
                className="page-link"
                onClick={() => onPage?.(Number(href.split(":")[1]))}
              >
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}
