import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { DATA, all, save } from "./db.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
export const MAX_PDF = 80 * 1024 * 1024;
function isPrivate(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s.includes(":")) return !/^[23][0-9a-f]{3}:/.test(s);
  return /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.|198\.(1[89])\.|2[2-5]\d\.)/.test(
    s,
  );
}
export async function publicURL(input: string) {
  const u = new URL(input);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !["", "80", "443"].includes(u.port)
  )
    throw new Error("仅支持公开 HTTP(S) 链接");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  const trusted = [
    "arxiv.org",
    "www.arxiv.org",
    "export.arxiv.org",
    "openreview.net",
    "www.openreview.net",
    "api2.openreview.net",
    "api.openreview.net",
    "proceedings.neurips.cc",
    "proceedings.mlr.press",
    "aclanthology.org",
    "openaccess.thecvf.com",
    "jmlr.org",
    "www.jmlr.org",
  ];
  if (
    !ips.length ||
    (ips.some((x) => isPrivate(x.address)) && !trusted.includes(host))
  )
    throw new Error(
      "不能下载本机或内网地址（若公共站点被代理解析为内网地址，请下载 PDF 后上传）",
    );
  return u;
}
export async function download(
  input: string,
  limit = MAX_PDF,
  timeoutMs = 60000,
): Promise<Buffer> {
  let url = input;
  for (let i = 0; i < 6; i++) {
    await publicURL(url);
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "IIDResearchWorkbench/1.0" },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location")!, url).href;
      await r.body?.cancel();
      continue;
    }
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`);
    if (Number(r.headers.get("content-length")) > limit) {
      await r.body?.cancel();
      throw new Error("文件超过大小限制");
    }
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const chunk of r.body as any) {
      n += chunk.length;
      if (n > limit) throw new Error("文件超过大小限制");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("重定向次数过多");
}
export function parseSource(input: string): {
  url: string;
  identifier?: string;
  openreviewUrl?: string;
} {
  const u = new URL(input);
  const host = u.hostname.toLowerCase();
  if (host === "arxiv.org" || host === "www.arxiv.org") {
    const id = u.pathname.replace(/^\/(abs|pdf)\//, "").replace(/\.pdf$/, "");
    if (!/^(\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(v\d+)?$/i.test(id))
      throw new Error("arXiv 地址不正确");
    return {
      url: `https://arxiv.org/pdf/${id}`,
      identifier: `arxiv:${id.replace(/v\d+$/, "")}`,
    };
  }
  if (host === "openreview.net" || host === "www.openreview.net") {
    const id = u.searchParams.get("id");
    if (!id || !/^[\w-]+$/.test(id))
      throw new Error("OpenReview 链接缺少有效 id");
    return {
      url: `https://openreview.net/pdf?id=${id}`,
      identifier: `openreview:${id}`,
      openreviewUrl: `https://openreview.net/forum?id=${id}`,
    };
  }
  return { url: u.href };
}
export async function importPDF(
  buffer: Buffer,
  filename: string,
  source: Record<string, any> = {},
  table: "papers" | "reviewDocuments" = "papers",
) {
  if (buffer.length > MAX_PDF) throw new Error("PDF 不得超过 80 MB");
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new Error("文件不是有效 PDF");
  const hash = createHash("sha256").update(buffer).digest("hex");
  const dup = all(table).find(
    (p) =>
      (!source.reviewId || p.reviewId === source.reviewId) &&
      (p.hash === hash || (source.identifier && p.identifier === source.identifier)),
  );
  if (dup) return { paper: dup, duplicate: true };
  const loading = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  let pdf;
  try {
    pdf = await loading.promise;
  } catch {
    throw new Error("PDF 已损坏、加密或无法解析");
  }
  const pages: string[] = [];
  let metadata: any = {};
  let inferredTitle = "";
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      if (i === 1) {
        const items = content.items.filter(
          (x: any) => x.str?.trim() && x.height > 0,
        ) as any[];
        const max = Math.max(
          ...items.filter((x) => x.transform?.[5] > 300).map((x) => x.height),
        );
        inferredTitle = items
          .filter((x) => x.height >= max * 0.86 && x.str.trim().length > 1)
          .map((x) => x.str)
          .join(" ")
          .trim();
        if (inferredTitle.length < 8 || inferredTitle.length > 400)
          inferredTitle = "";
      }
      pages.push(
        content.items
          .map((x: any) => (x.str ? x.str + (x.hasEOL ? "\n" : " ") : ""))
          .join(""),
      );
    }
    metadata = await pdf.getMetadata();
  } finally {
    await loading.destroy();
  }
  const first = pages[0] || "";
  const embedded = metadata.info || {};
  const cleanTitle = String(embedded.Title || "").trim();
  const title =
    source.title ||
    (cleanTitle && !/^(untitled|microsoft|latex|arxiv)/i.test(cleanTitle)
      ? cleanTitle
      : inferredTitle || path.basename(filename, ".pdf"));
  const abstract =
    first
      .match(
        /\babstract\b[\s.:—-]*([\s\S]{30,2500}?)(?:\b1[.\s]+introduction\b|\bkeywords\b|\bindex terms\b|$)/i,
      )?.[1]
      ?.trim() || "";
  const file = hash + ".pdf";
  await writeFile(path.join(DATA, "pdfs", file), buffer, { flag: "wx" }).catch(
    (e: any) => {
      if (e.code !== "EEXIST") throw e;
    },
  );
  const paper = save(table, {
    ...(source.reviewId ? { reviewId: source.reviewId } : {}),
    title,
    authors: source.authors || String(embedded.Author || ""),
    abstract: source.abstract || abstract,
    year: source.year || "",
    venue: source.venue || "",
    tags: [],
    meaning: "",
    status: "unread",
    manualScore: null,
    note: "",
    lastPage: 1,
    zoom: 1,
    pages,
    pageCount: pages.length,
    hash,
    file,
    originalName: filename,
    sourceUrl: source.sourceUrl || "",
    identifier: source.identifier || "",
    openreviewUrl: source.openreviewUrl || "",
  });
  return { paper, duplicate: false };
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}
export async function linkMetadata(
  input: string,
): Promise<Record<string, string>> {
  try {
    const u = new URL(input);
    if (["arxiv.org", "www.arxiv.org"].includes(u.hostname)) {
      const id = parseSource(input).identifier!.slice(6);
      const html = (
        await download(`https://arxiv.org/abs/${id}`, 4e6)
      ).toString();
      const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0]);
      const values = (name: string) =>
        metas
          .filter((m) => new RegExp(`name=["']${name}["']`, "i").test(m))
          .map((m) =>
            decodeEntities(
              m.match(/content=["']([\s\S]*?)["']\s*\/?\s*>/i)?.[1] || "",
            ),
          );
      return {
        title: values("citation_title")[0] || "",
        authors: values("citation_author").join(", "),
        year: values("citation_date")[0]?.slice(0, 4) || "",
        abstract: decodeEntities(
          (
            html.match(
              /<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i,
            )?.[1] || ""
          )
            .replace(/<span[^>]*>[\s\S]*?<\/span>/, "")
            .replace(/<[^>]+>/g, "")
            .trim(),
        ),
      };
    }
    if (["openreview.net", "www.openreview.net"].includes(u.hostname)) {
      const id = u.searchParams.get("id");
      for (const api of [
        "https://api2.openreview.net",
        "https://api.openreview.net",
      ]) {
        try {
          const data = JSON.parse(
            (
              await download(
                `${api}/notes?id=${encodeURIComponent(id || "")}`,
                8e6,
              )
            ).toString(),
          );
          const c = data.notes?.[0]?.content;
          if (c) {
            const val = (k: string) => c[k]?.value ?? c[k] ?? "";
            return {
              title: val("title"),
              authors: Array.isArray(val("authors"))
                ? val("authors").join(", ")
                : val("authors"),
              abstract: val("abstract"),
              venue: val("venue"),
            };
          }
        } catch {}
      }
    }
    return {};
  } catch {
    return {};
  }
}
