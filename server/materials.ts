import { codexThreadId, readCodexMaterial } from "./codex-material.ts";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  readdir,
  realpath,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DATA, save, get } from "./db.ts";
import { projectRows, requireMaterial } from "./project-store.ts";
import { publicURL } from "./import.ts";
const exec = promisify(execFile),
  MAX = 20 * 1024 * 1024,
  TEXT = 220000;
const textExt = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".log",
  ".yaml",
  ".yml",
  ".py",
  ".ts",
  ".js",
  ".tex",
  ".bib",
  ".ipynb",
  ".html",
  ".xml",
]);
export async function scopedPath(root: string, relative: string) {
  if (path.isAbsolute(relative))
    throw new Error("只能提供资料目录内的相对路径");
  const base = await realpath(root),
    target = await realpath(path.resolve(base, relative));
  if (target !== base && !target.startsWith(base + path.sep))
    throw new Error("访问超出已绑定资料目录");
  return target;
}
export async function parseFile(file: string) {
  const info = await stat(file);
  if (info.size > MAX) throw new Error("单文件读取上限为 20 MB；原件仍可保留");
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext))
    return {
      text: "图片资料，已提供原图供项目助手阅读。",
      imagePath: file,
      truncated: false,
    };
  if (ext === ".pdf") {
    const loading = getDocument({
      data: new Uint8Array(await readFile(file)),
      useSystemFonts: true,
    });
    try {
      const pdf = await loading.promise;
      let text = "",
        hasText = false;
      for (let i = 1; i <= Math.min(pdf.numPages, 200); i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        hasText ||= content.items.some((x: any) => x.str?.trim());
        text +=
          `\n=== 第 ${i} 页 ===\n` +
          content.items
            .map((x: any) => (x.str ? x.str + (x.hasEOL ? "\n" : " ") : ""))
            .join("");
        if (text.length > TEXT) break;
      }
      return {
        text: text.slice(0, TEXT),
        warning: hasText
          ? undefined
          : "PDF 无可提取正文（可能为扫描件），未进行 OCR。",
        truncated: text.length > TEXT || pdf.numPages > 200,
      };
    } finally {
      await loading.destroy();
    }
  }
  if ([".docx", ".xlsx"].includes(ext)) {
    const r = await exec(
      process.env.IID_PYTHON || "python3",
      [path.resolve("scripts/extract-office.py"), file],
      { timeout: 20000, maxBuffer: 4e6 },
    );
    return JSON.parse(r.stdout);
  }
  if (!textExt.has(ext))
    return {
      text: "暂不支持自动解析此格式，原件已保留。",
      unsupported: true,
      truncated: false,
    };
  let text = await readFile(file, "utf8");
  if (ext === ".ipynb") {
    const notebook = JSON.parse(text);
    const joinText = (v: any) =>
      Array.isArray(v) ? v.join("") : String(v || "");
    text = (notebook.cells || [])
      .map(
        (c: any) =>
          `## ${c.cell_type}\n${joinText(c.source)}\n${(c.outputs || []).map((o: any) => joinText(o.text || o.data?.["text/plain"])).join("\n")}`,
      )
      .join("\n\n");
  }
  return { text: text.slice(0, TEXT), truncated: text.length > TEXT };
}
export async function readDirectory(root: string) {
  const files: any[] = [];
  let skipped = 0;
  async function walk(dir: string, depth: number) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        entry.name.startsWith(".") ||
        ["node_modules", "__pycache__", "venv", "dist"].includes(entry.name)
      )
        continue;
      if (files.length >= 40) {
        skipped++;
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped++;
        continue;
      }
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 2) await walk(file, depth + 1);
        else skipped++;
      } else if (entry.isFile()) {
        const rel = path.relative(root, file);
        if (textExt.has(path.extname(file).toLowerCase())) {
          const s = await stat(file);
          if (s.size <= 512000) {
            files.push({ path: rel, ...(await parseFile(file)) });
          } else
            files.push({
              path: rel,
              size: s.size,
              note: "文件较大，仅列出路径；可由助手按资料范围追加读取。",
            });
        } else
          files.push({ path: rel, note: "非文本附件，可单独绑定后解析。" });
      }
    }
  }
  await walk(root, 0);
  const full = JSON.stringify({ files, skipped }, null, 2);
  return {
    text: full.slice(0, TEXT),
    truncated: full.length > TEXT || skipped > 0,
  };
}
export function assertSourceURL(material: any, input: string) {
  const url = new URL(input),
    base = new URL(material.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== base.origin
  )
    throw new Error("网址不属于此资料已绑定的来源");
  if (
    material.adapter === "fspe" &&
    url.pathname !== "/" &&
    !url.pathname.startsWith("/api/selfgen-zsre1000/")
  )
    throw new Error("仅允许 FSPE 主线只读接口");
  if (url.pathname.startsWith("/download/"))
    throw new Error("请使用只读状态接口，不自动执行导出操作");
  return url;
}
async function publicProjectURL(input: string) {
  const u = new URL(input);
  // Feishu public tenants use split DNS on this machine; retain TLS host verification.
  if (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === "443") &&
    /^[a-z0-9-]+\.feishu\.cn$/i.test(u.hostname)
  )
    return u;
  return publicURL(input);
}
export async function boundFetch(material: any, input: string) {
  const u = assertSourceURL(material, input);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    await publicProjectURL(u.href);
  const response = await fetch(u, {
    redirect: "manual",
    headers: { "User-Agent": "IID Research Workspace" },
    signal: AbortSignal.timeout(25000),
  });
  if ([401, 403].includes(response.status))
    throw Object.assign(
      new Error(
        `网页需要登录或访问权限（HTTP ${response.status}），已保存链接，正文尚未读取。`,
      ),
      { code: "NEEDS_AUTH" },
    );
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") || "";
    await response.body?.cancel();
    if (/login|signin|accounts\.feishu\.cn/i.test(location))
      throw Object.assign(
        new Error(
          "网页需要登录或访问权限，已保存链接，正文尚未读取。可提供可公开访问的链接，或导出文件后上传。",
        ),
        { code: "NEEDS_AUTH" },
      );
    throw new Error("网页重定向，请使用浏览器最终显示的页面地址重新绑定。");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > 6e6) throw new Error("网页响应超过 6 MB");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function renderWeb(material: any) {
  const u = assertSourceURL(material, material.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    await publicProjectURL(u.href);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await page.routeWebSocket("**/*", (ws) => ws.close());
    const responses: any[] = [];
    await page.route("**/*", async (route) => {
      const req = route.request(),
        target = new URL(req.url());
      if (
        !["GET", "HEAD"].includes(req.method()) ||
        (req.isNavigationRequest() && target.origin !== u.origin) ||
        ["font", "image", "media"].includes(req.resourceType()) ||
        (["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
          target.origin !== u.origin)
      )
        return route.abort();
      return route.continue();
    });
    page.on("response", async (response) => {
      if (
        responses.length >= 6 ||
        !response.headers()["content-type"]?.includes("application/json") ||
        new URL(response.url()).origin !== u.origin
      )
        return;
      try {
        const body = await response.text();
        if (body.length < 500000)
          responses.push({ url: response.url(), data: JSON.parse(body) });
      } catch {}
    });
    await page.goto(u.href, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page
      .waitForLoadState("networkidle", { timeout: 2500 })
      .catch(() => {});
    const title = await page.title(),
      text = await page.locator("body").innerText({ timeout: 5000 });
    if (
      text.length < 1500 &&
      /扫码登录|验证码登录|请先登录|Sign in to|Log in to/i.test(text)
    )
      throw Object.assign(
        new Error("网页显示登录页面，已保存链接，正文尚未读取。"),
        { code: "NEEDS_AUTH" },
      );
    return {
      text: JSON.stringify(
        { title, url: u.href, body: text, jsonResponses: responses },
        null,
        2,
      ).slice(0, TEXT),
      truncated: text.length > TEXT,
    };
  } finally {
    await browser.close();
  }
}
async function fetchWeb(material: any) {
  if (material.adapter === "fspe") {
    const paths = ["state", "mmlu"];
    const data = await Promise.all(
      paths.map(async (endpoint) => ({
        url: new URL("/api/selfgen-zsre1000/" + endpoint, material.url).href,
        data: JSON.parse(
          (
            await boundFetch(
              material,
              new URL("/api/selfgen-zsre1000/" + endpoint, material.url).href,
            )
          ).toString(),
        ),
      })),
    );
    const state = data[0].data;
    const { timing, ...conciseState } = state;
    return {
      text: JSON.stringify(
        {
          source: material.url,
          focus:
            "当前自生成千条主线；NeuralDB 修正版与旧 NeuralDB 成绩严格分开。编辑完成、MMLU 完成与整体验收完成不是同一件事。",
          state: { url: data[0].url, data: conciseState },
          mmlu: data[1],
          omittedDetail:
            "逐条计时明细不放入 AI 摘要；完整原始接口内容保存在此版本 raw 字段。",
        },
        null,
        2,
      ),
      truncated: false,
      raw: data,
      structured: {
        stage: state.stage,
        complete: state.complete,
        stale: state.stale,
        lastSuccessEpoch: state.last_success_epoch,
        editsDone: state.edit_requests_done,
        editsExpected: state.new_edit_requests_expected,
        mmlu: data[1].data,
        repair: state.neuraldb_repair,
      },
    };
  }
  const raw = await boundFetch(material, material.url);
  const content = raw.toString();
  if (/^[\s]*[\[{]/.test(content)) {
    try {
      return {
        text: JSON.stringify(JSON.parse(content), null, 2).slice(0, TEXT),
        truncated: content.length > TEXT,
      };
    } catch {}
  }
  if (!/<html|<!doctype/i.test(content))
    return { text: content.slice(0, TEXT), truncated: content.length > TEXT };
  try {
    return await renderWeb(material);
  } catch (e: any) {
    if (e.code === "NEEDS_AUTH") throw e;
    return {
      text: content
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, TEXT),
      truncated: content.length > TEXT,
      warning: "动态渲染失败，仅获取静态正文：" + e.message,
    };
  }
}
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export async function readInspire(m: any) {
  const args = ["--json", ...(m.account ? ["--account", m.account] : [])];
  if (!m.workspace || !m.resourceName)
    throw new Error("请补充 Inspire Workspace 和资源名称");
  const kind = m.resourceKind === "job" ? "job" : "notebook";
  const status = await exec(
    "inspire",
    [...args, kind, "status", m.resourceName, "--workspace", m.workspace],
    { timeout: 45000, maxBuffer: 2e6 },
  );
  const result: any = { status: JSON.parse(status.stdout) };
  if (kind === "job") {
    const logs = await exec(
      "inspire",
      [
        ...args,
        "job",
        "logs",
        m.resourceName,
        "--workspace",
        m.workspace,
        "--tail",
        "60",
      ],
      { timeout: 45000, maxBuffer: 1e6 },
    );
    result.logs = logs.stdout;
  }
  if (m.remotePath) {
    if (
      !m.remotePath.startsWith("/inspire/") ||
      /[\x00-\x1f]/.test(m.remotePath)
    )
      throw new Error("远端结果路径必须是 /inspire/ 下的绝对路径");
    if (kind !== "notebook")
      throw new Error(
        "读取远端路径请绑定 Notebook 作为只读访问入口；Job 本身支持状态和日志",
      );
    const script = `import os,sys,json\np=os.path.realpath(sys.argv[1]);out=[]\npaths=[p] if os.path.isfile(p) else [os.path.join(p,n) for n in sorted(os.listdir(p))[:30] if os.path.isfile(os.path.join(p,n)) and not os.path.islink(os.path.join(p,n))]\nfor f in paths:\n if os.path.getsize(f)<524288 and os.path.splitext(f)[1].lower() in ['.json','.jsonl','.csv','.txt','.log','.md','.yaml','.yml']:\n  with open(f,errors='replace') as h: out.append({'path':f,'text':h.read(120000)})\n else: out.append({'path':f,'size':os.path.getsize(f),'note':'仅列出文件；未自动读取大文件或二进制结果'})\nprint(json.dumps(out,ensure_ascii=False))`;
    const output = await exec(
      "inspire",
      [
        ...args,
        "notebook",
        "exec",
        m.resourceName,
        "--workspace",
        m.workspace,
        "--timeout",
        "45",
        "python3 -c " + shellQuote(script) + " " + shellQuote(m.remotePath),
      ],
      { timeout: 55000, maxBuffer: 2e6 },
    );
    result.files = output.stdout;
  }
  const text = JSON.stringify(result, null, 2);
  return { text: text.slice(0, TEXT), truncated: text.length > TEXT };
}
export async function captureMaterial(m: any) {
  const checkedAt = new Date().toISOString();
  try {
    let parsed: any;
    if (m.kind === "codex") parsed = await readCodexMaterial(m);
    else if (m.kind === "web") parsed = await fetchWeb(m);
    else if (m.kind === "inspire") parsed = await readInspire(m);
    else if (m.kind === "text")
      parsed = { text: m.content || "", truncated: false };
    else {
      const resolved = await realpath(m.path);
      const info = await stat(resolved);
      parsed = info.isDirectory()
        ? await readDirectory(resolved)
        : await parseFile(resolved);
    }
    parsed.truncated =
      !!parsed.truncated || String(parsed.text || "").length > TEXT;
    parsed.text = String(parsed.text || "").slice(0, TEXT);
    const hash = createHash("sha256")
      .update(parsed.text)
      .update(parsed.imagePath ? await readFile(parsed.imagePath) : "")
      .digest("hex");
    const previous = projectRows("materialSnapshots", m.projectId).find(
      (s) => s.materialId === m.id && s.hash === hash,
    );
    let snapshot = previous;
    if (!snapshot) {
      const dir = path.join(DATA, "projects", m.projectId, "snapshots");
      await mkdir(dir, { recursive: true });
      if (parsed.imagePath) {
        const imageCopy = path.join(
          dir,
          randomUUID() + path.extname(parsed.imagePath),
        );
        await writeFile(imageCopy, await readFile(parsed.imagePath));
        parsed.imagePath = imageCopy;
      }
      snapshot = save("materialSnapshots", {
        projectId: m.projectId,
        materialId: m.id,
        hash,
        fetchedAt: checkedAt,
        ...parsed,
      });
      await writeFile(
        path.join(dir, snapshot.id + ".json"),
        JSON.stringify(snapshot, null, 2),
      );
    }
    save("materials", {
      ...get("materials", m.id),
      ...(m.kind === "codex" &&
      m.title === "Codex 会话 · " + m.threadId &&
      parsed.thread?.title
        ? { title: parsed.thread.title }
        : {}),
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: checkedAt,
      status: parsed.unsupported
        ? "unsupported"
        : parsed.warning
          ? "partial"
          : "ready",
      error: parsed.warning || null,
      snapshotId: snapshot.id,
    });
    return { ...snapshot, checkedAt };
  } catch (e: any) {
    save("materials", {
      ...get("materials", m.id),
      lastCheckedAt: checkedAt,
      status: e.code === "NEEDS_AUTH" ? "needs_auth" : "error",
      error: e.message,
    });
    const last = m.snapshotId ? get("materialSnapshots", m.snapshotId) : null;
    return {
      ...last,
      materialId: m.id,
      error: e.message,
      checkedAt,
      stale: true,
      text: last?.text || "资料未能读取。",
    };
  }
}
export async function createMaterial(
  projectId: string,
  input: any,
  upload?: { buffer: Buffer; filename: string },
) {
  const kind = upload ? "upload" : input.kind;
  if (!["upload", "local", "web", "inspire", "text", "codex"].includes(kind))
    throw new Error("不支持的资料类型");
  const id = randomUUID();
  const m: any = {
    id,
    projectId,
    kind,
    title: String(
      input.title || upload?.filename || input.path || input.url || "项目资料",
    ).slice(0, 300),
    description: String(input.description || "").slice(0, 10000),
    category: String(input.category || "参考资料").slice(0, 100),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 30).map(String) : [],
    active: input.active === true,
    status: "pending",
    summary: "",
  };
  if (upload) {
    if (upload.buffer.length > MAX) throw new Error("项目附件上限 20 MB");
    const dir = path.join(DATA, "projects", projectId, "attachments");
    await mkdir(dir, { recursive: true });
    m.filename = path.basename(upload.filename);
    m.path = path.join(dir, id + path.extname(m.filename).toLowerCase());
    await writeFile(m.path, upload.buffer);
  } else if (kind === "local") {
    if (!path.isAbsolute(input.path || ""))
      throw new Error("请输入本地绝对路径");
    m.path = await realpath(input.path);
    m.isDirectory = (await stat(m.path)).isDirectory();
  } else if (kind === "codex") {
    m.threadId = codexThreadId(String(input.url || ""));
    m.url = "codex://threads/" + m.threadId;
    if (!input.title) m.title = "Codex 会话 · " + m.threadId;
  } else if (kind === "web") {
    const u = new URL(input.url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error("请输入 HTTP(S) 网页地址");
    // Save the reference independently of network reachability; capture validates access.
    m.url = u.href;
    m.adapter = input.adapter === "fspe" ? "fspe" : "web";
  } else if (kind === "inspire") {
    for (const k of ["account", "workspace", "resourceName", "remotePath"])
      m[k] = String(input[k] || "").slice(0, 2000);
    m.resourceKind = input.resourceKind === "job" ? "job" : "notebook";
    if (!m.workspace || !m.resourceName)
      throw new Error("请填写 Workspace 和资源名称");
  } else m.content = String(input.content || "").slice(0, TEXT);
  save("materials", m);
  await captureMaterial(m);
  return get("materials", id);
}
export async function readBoundFile(
  projectId: string,
  id: string,
  relative: string,
) {
  const m = requireMaterial(projectId, id);
  if (m.kind !== "local" || !m.isDirectory)
    throw new Error("该资料不是已绑定的本地目录");
  return parseFile(await scopedPath(m.path, relative));
}
