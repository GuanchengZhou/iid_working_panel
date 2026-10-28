import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { download, publicURL, MAX_PDF } from "./import.ts";
import { titleMatches } from "./openreview.ts";
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function parseArxivFeed(xml: string) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((m) => {
      const value = (tag: string) =>
        decode(
          m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ||
            "",
        );
      return {
        url: value("id").replace(/^http:/, "https:"),
        title: value("title"),
        date: value("published"),
        authors: [...m[1].matchAll(/<name>([\s\S]*?)<\/name>/g)].map((x) =>
          decode(x[1]),
        ),
        abstract: value("summary"),
        source: "arXiv",
      };
    })
    .filter((x) => /^https:\/\/arxiv.org\/abs\//.test(x.url));
}
export async function discoverPublicVersions(
  title: string,
  signal: AbortSignal,
  fetcher = download,
) {
  const tokens = title.match(/[\p{L}\p{N}-]+/gu) || [];
  const key = tokens
    .filter(
      (t) =>
        !["of", "the", "with", "and", "via", "for", "a", "an", "in"].includes(
          t.toLowerCase(),
        ),
    )
    .slice(0, 4);
  const arxiv =
    "https://export.arxiv.org/api/query?" +
    new URLSearchParams({
      search_query: key.map((w) => "ti:" + w).join(" AND "),
      max_results: "20",
      sortBy: "submittedDate",
      sortOrder: "descending",
    });
  const term = key.slice(0, 3).join(" ");
  const sources = [
    { source: "arXiv", url: arxiv },
    {
      source: "OpenReview v2",
      url:
        "https://api2.openreview.net/notes/search?" +
        new URLSearchParams({
          term,
          content: "title",
          source: "forum",
          limit: "30",
        }),
    },
    {
      source: "OpenReview v1",
      url:
        "https://api.openreview.net/notes/search?" +
        new URLSearchParams({
          term,
          content: "title",
          source: "forum",
          limit: "30",
        }),
    },
  ];
  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        if (signal.aborted) throw new Error("任务取消");
        const raw = (await fetcher(src.url, 3 * 1024 * 1024)).toString("utf8");
        let candidates: any[];
        if (src.source === "arXiv") candidates = parseArxivFeed(raw);
        else {
          const json = JSON.parse(raw);
          if (!Array.isArray(json.notes))
            throw new Error(json.message || "API 未返回 notes");
          candidates = json.notes
            .filter((n: any) => !n.replyto)
            .map((n: any) => {
              const val = (k: string) =>
                n.content?.[k]?.value ?? n.content?.[k] ?? "";
              return {
                url:
                  "https://openreview.net/forum?id=" +
                  encodeURIComponent(n.forum || n.id),
                title: String(val("title")),
                date: n.cdate ? new Date(n.cdate).toISOString() : "",
                authors: val("authors"),
                abstract: String(val("abstract")),
                source: src.source,
              };
            });
        }
        return {
          ...src,
          fetchedAt: new Date().toISOString(),
          candidates: candidates.filter((c) => titleMatches(title, c.title)),
          raw,
        };
      } catch (e: any) {
        return {
          ...src,
          fetchedAt: new Date().toISOString(),
          candidates: [],
          error: e.message,
        };
      }
    }),
  );
  if (signal.aborted) throw new Error("任务已取消");
  const candidates = [
    ...new Map(
      results.flatMap((x) => x.candidates).map((x) => [x.url, x]),
    ).values(),
  ];
  return { queryTitle: title, sources: results, candidates };
}

// Public paper hosts occasionally stall under Node's HTTP transport on local proxies.
// Preserve URL checks and TLS validation; curl receives only argument-array input.
export async function downloadReviewVersion(url: string): Promise<Buffer> {
  try {
    return await download(url, MAX_PDF, 15000);
  } catch (first) {
    const parsed = await publicURL(url);
    if (
      ![
        "arxiv.org",
        "www.arxiv.org",
        "export.arxiv.org",
        "openreview.net",
        "www.openreview.net",
      ].includes(parsed.hostname)
    )
      throw first;
    try {
      const { stdout } = await promisify(execFile)(
        "/usr/bin/curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          "120",
          "--max-filesize",
          String(MAX_PDF),
          "--proto",
          "=https,http",
          url,
        ],
        { encoding: "buffer", maxBuffer: MAX_PDF, timeout: 125000 },
      );
      return stdout;
    } catch {
      throw new Error(
        "公开稿 PDF 下载失败或超时；链接已保留，可稍后重试或上传已下载的公开版本。",
      );
    }
  }
}
