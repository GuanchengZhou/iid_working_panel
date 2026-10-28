export type Paper = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  year: string;
  venue: string;
  tags: string[];
  meaning: string;
  status: "unread" | "reading" | "read";
  manualScore: number | null;
  note: string;
  lastPage: number;
  zoom: number;
  pageCount: number;
  hasText: boolean;
  openreviewUrl: string;
  sourceUrl: string;
  identifier: string;
  createdAt: string;
  updatedAt: string;
};
export type Annotation = {
  id: string;
  paperId: string;
  page: number;
  text: string;
  comment: string;
  color: string;
  rects: { x: number; y: number; width: number; height: number }[];
};
export type Analysis = {
  id: string;
  paperId: string;
  type: string;
  markdown: string;
  score: number | null;
  createdAt: string;
  model: string;
  snapshotId?: string;
  source?: string;
  evidence?: { page: number; quote: string; verified: boolean }[];
  references?: {
    noteId: string;
    claim: string;
    verified: boolean;
    url: string;
  }[];
};
export type Task = {
  id: string;
  type: string;
  paperId?: string;
  projectId?: string;
  chatId?: string;
  messageId?: string;
  status: string;
  stage: string;
  error?: string;
  output?: string;
  createdAt: string;
  candidates?: {
    url: string;
    title: string;
    authors: string;
    reason: string;
  }[];
};
export type Chat = { id: string; paperId?: string; title: string };
export type Message = {
  id: string;
  role: string;
  content: string;
  attachments?: string;
  createdAt: string;
};
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (
    typeof options.body === "string" &&
    options.body.length > 0 &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  let r: Response;
  try {
    r = await fetch("/api" + url, { ...options, headers });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      "无法连接本地工作台服务。请双击「启动工作台.command」，保持启动窗口打开，再重试；若服务正在运行，请检查本地网络或代理设置。",
    );
  }
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "请求失败");
  return value;
}
