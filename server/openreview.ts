import { download } from "./import.ts";
export function forumId(url: string) {
  const u = new URL(url);
  if (
    !["openreview.net", "www.openreview.net"].includes(u.hostname) ||
    !["http:", "https:"].includes(u.protocol)
  )
    throw new Error("请输入 OpenReview forum 或 PDF 链接");
  const id = u.searchParams.get("id");
  if (!id || !/^[\w-]+$/.test(id))
    throw new Error("OpenReview 链接缺少有效 id");
  return id;
}
export function normalizeNote(n: any) {
  const content = Object.fromEntries(
    Object.entries(n.content || {}).map(([k, v]: any) => [
      k,
      v && typeof v === "object" && "value" in v ? v.value : v,
    ]),
  );
  const invitations = (n.invitations || [n.invitation || ""]).join(" ");
  const kind = /meta.?review|area.?chair/i.test(invitations)
    ? "meta-review"
    : /decision/i.test(invitations)
      ? "decision"
      : /official.?review|\/review\b/i.test(invitations)
        ? "review"
        : /rebuttal|response/i.test(invitations)
          ? "response"
          : "comment";
  return {
    id: n.id,
    forum: n.forum,
    replyto: n.replyto,
    kind,
    invitations,
    signatures: n.signatures || [],
    createdAt: n.cdate,
    modifiedAt: n.mdate,
    content,
    url: `https://openreview.net/forum?id=${n.forum || n.id}&noteId=${n.id}`,
  };
}
export async function fetchForum(url: string) {
  const id = forumId(url);
  const errors: string[] = [];
  for (const api of [
    "https://api2.openreview.net",
    "https://api.openreview.net",
  ]) {
    try {
      const root = JSON.parse(
        (
          await download(`${api}/notes?id=${encodeURIComponent(id)}`, 8e6)
        ).toString(),
      );
      if (!root.notes?.length) throw new Error("没有公开的论文记录");
      const notes: any[] = [];
      for (let offset = 0; offset < 10000; offset += 1000) {
        const batch = JSON.parse(
          (
            await download(
              `${api}/notes?forum=${encodeURIComponent(id)}&limit=1000&offset=${offset}`,
              25e6,
            )
          ).toString(),
        );
        if (!Array.isArray(batch.notes))
          throw new Error("OpenReview 返回了异常数据");
        notes.push(...batch.notes);
        if (batch.notes.length < 1000) break;
        if (offset === 9000) throw new Error("评论过多，未能完整抓取");
      }
      return {
        forumId: id,
        url: `https://openreview.net/forum?id=${id}`,
        api,
        fetchedAt: new Date().toISOString(),
        submission: normalizeNote(root.notes[0]),
        notes: [
          ...new Map(notes.map((n) => [n.id, normalizeNote(n)])).values(),
        ].filter((n) => n.id !== id),
        raw: { submission: root.notes[0], notes },
      };
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  throw new Error("OpenReview 无法访问或内容未公开：" + errors.join("；"));
}
export function titleMatches(a: string, b: string) {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const aa = words(a),
    bb = words(b);
  if (!aa.size || !bb.size) return false;
  return (
    [...aa].filter((x) => bb.has(x)).length / Math.max(aa.size, bb.size) >= 0.65
  );
}
