import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
const dir = mkdtempSync(path.join(tmpdir(), "iid-reviews-"));
process.env.IID_DATA_DIR = dir;
const db = await import("../server/db.ts");
const store = await import("../server/review-store.ts");
const { registerReviews } = await import("../server/reviews.ts");
const { executeReviewTask } = await import("../server/review-runner.ts");
function fixture(id: string) {
  const doc = db.save("reviewDocuments", {
    reviewId: id,
    title: "Example",
    hash: "hash-" + id,
    pages: ["Alpha evidence text.", "Figure 1 p = 0.02"],
    pageCount: 2,
    file: "fixture.pdf",
    lastPage: 1,
    zoom: 1,
  });
  const review = db.save("reviewCases", {
    id,
    title: "Example",
    venue: "",
    deadline: "",
    status: "unread",
    documentId: doc.id,
    requirements: "",
    analysisLanguage: "中文",
    reviewLanguage: "English",
    stepSettings: store.defaultReviewSettings(),
    draftSections: store.defaultSections.map((heading, i) => ({
      id: "s" + i,
      heading,
      content: "",
    })),
    draftRevision: 0,
    issueRevision: 0,
    settingsRevision: 0,
    scoreScales: "",
    scores: {},
  });
  return { review, doc };
}
const a = fixture("review-a"),
  b = fixture("review-b");
const app = Fastify();
app.setErrorHandler((e: any, _q, r) => r.code(400).send({ error: e.message }));
registerReviews(
  app,
  (type: string, _: any, extra: any) =>
    db.save("tasks", { type, status: "queued", ...extra }),
  () => {},
);
const req = (method: any, url: string, payload?: any) =>
  app.inject({ method, url, payload });
test("审稿问题位置、跨任务隔离及设置持久化", async () => {
  let r = await req("POST", "/api/reviews/review-a/issues", {
    kind: "location",
    page: 2,
    quote: "p = 0.02",
    rects: [{ x: 0.2, y: 0.3, width: 0.1, height: 0.02 }],
    content: "为什么图中数值不同？",
  });
  assert.equal(r.statusCode, 200);
  const issue = r.json();
  assert.equal(issue.pdfHash, a.doc.hash);
  r = await req("PATCH", `/api/reviews/review-b/issues/${issue.id}`, {
    content: "overwrite",
    expectedUpdatedAt: issue.updatedAt,
  });
  assert.equal(r.statusCode, 400);
  r = await req("POST", "/api/reviews/review-a/issues", {
    kind: "location",
    page: 99,
    content: "bad",
  });
  assert.equal(r.statusCode, 400);
  r = await req("POST", "/api/reviews/review-a/issues", {
    kind: "global",
    content: "Does the utility assumption hold?",
  });
  assert.equal(r.statusCode, 200);
  assert.equal(db.all("papers").length, 0);
  assert.equal(store.rows("reviewIssues", "review-b").length, 0);
  r = await req("PATCH", "/api/reviews/review-a", {
    stepSettings: {
      analysis: { model: "gpt-6.1-sol", reasoningEffort: "high" },
    },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().stepSettings.analysis.model, "gpt-6.1-sol");
  assert.equal(r.json().stepSettings.polish.model, "gpt-6-luna");
  assert.equal(
    (
      await req("PATCH", "/api/reviews/review-a", {
        stepSettings: {
          analysis: { model: "invalid", reasoningEffort: "medium" },
        },
      })
    ).statusCode,
    400,
  );
});
test("AI 草稿候选分章节采用、并发保护、历史恢复和导出", async () => {
  const initial = store.requireReview("review-a");
  const out = db.save("reviewOutputs", {
    reviewId: "review-a",
    documentId: a.doc.id,
    step: "draft",
    input: { draftRevision: 0 },
    sections: initial.draftSections.map((s: any) => ({
      ...s,
      content:
        s.id === "s0"
          ? "Summary [第 2 页](paper-page:2)"
          : "Proposed " + s.heading,
    })),
  });
  let r = await req("POST", `/api/reviews/review-a/outputs/${out.id}/adopt`, {
    expectedRevision: 0,
    sectionIds: ["s0"],
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().draftRevision, 1);
  assert.equal(r.json().draftSections[1].content, "");
  r = await req("POST", `/api/reviews/review-a/outputs/${out.id}/adopt`, {
    expectedRevision: 1,
    sectionIds: ["s1"],
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().draftRevision, 2);
  let ss = r.json().draftSections;
  ss[1].content = "My manual change";
  r = await req("PUT", "/api/reviews/review-a/draft", {
    expectedRevision: 2,
    sections: ss,
  });
  assert.equal(r.statusCode, 200);
  r = await req("POST", `/api/reviews/review-a/outputs/${out.id}/adopt`, {
    expectedRevision: 3,
    sectionIds: ["s2"],
  });
  assert.equal(r.statusCode, 400);
  assert.equal(
    (
      await req("PUT", "/api/reviews/review-a/draft", {
        expectedRevision: 2,
        sections: ss,
      })
    ).statusCode,
    400,
  );
  const history = store.rows("reviewDraftVersions", "review-a");
  assert.equal(history.length, 3);
  assert.equal(
    (
      await req(
        "POST",
        `/api/reviews/review-b/history/${history[0].id}/restore`,
        { expectedRevision: 0 },
      )
    ).statusCode,
    400,
  );
  r = await req("GET", "/api/reviews/review-a/export");
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /My manual change/);
  assert.doesNotMatch(r.body, /paper-page:/);
});
test("任务快照、原文证据校验、分段检测与取消保存边界", async () => {
  const input = store.snapshotInput("review-b"),
    task = db.save("tasks", {
      type: "review_step",
      reviewId: "review-b",
      status: "running",
      step: "analysis",
      model: "gpt-6-luna",
      reasoningEffort: "medium",
      input,
    });
  const result = {
    markdown: "Analysis",
    sections: [],
    evidence: [
      { page: 1, quote: "Alpha evidence" },
      { page: 2, quote: "invented" },
    ],
    findings: [],
    candidates: [],
  };
  await executeReviewTask(
    task,
    new AbortController().signal,
    async () => ({ text: JSON.stringify(result) }),
    () => {},
  );
  let out = store.rows("reviewOutputs", "review-b")[0];
  assert.equal(out.evidence[0].verified, true);
  assert.equal(out.evidence[1].verified, false);
  assert.equal(out.pdfHash, b.doc.hash);
  assert.equal(out.input.draftRevision, 0);
  const abort = new AbortController();
  const cancelTask = { ...task, id: "cancelled", step: "polish" };
  const count = store.rows("reviewOutputs", "review-b").length;
  await assert.rejects(
    executeReviewTask(
      cancelTask,
      abort.signal,
      async () => {
        abort.abort();
        return { text: JSON.stringify(result) };
      },
      () => {},
    ),
    /取消/,
  );
  assert.equal(store.rows("reviewOutputs", "review-b").length, count);
  const typo = { ...task, id: "typos", step: "typos" };
  await executeReviewTask(
    typo,
    new AbortController().signal,
    async () => ({
      text: JSON.stringify({
        ...result,
        findings: [
          {
            page: 2,
            quote: "p = 0.02",
            suggestion: "Check figure",
            category: "Consistency",
            confidence: "High",
            explanation: "Mismatch",
          },
        ],
      }),
    }),
    () => {},
  );
  out = store
    .rows("reviewOutputs", "review-b")
    .find((o) => o.step === "typos" && !o.partial);
  assert.equal(out.coverage.pages, 2);
  assert.equal(out.findings[0].verified, true);
  const d = await req("POST", "/api/reviews/review-b/tasks", {
    step: "validate",
  });
  assert.equal(d.statusCode, 400);
  db.recoverTasks();
  assert.equal(db.get("tasks", task.id)?.status, "interrupted");
});
test("初审搜索失败不阻塞论文分析和其他独立步骤", async () => {
  const r = fixture("review-c");
  const task = {
    id: "pipeline",
    type: "review_initial",
    reviewId: "review-c",
    status: "running",
    input: store.snapshotInput("review-c"),
    stepSettings: r.review.stepSettings,
  };
  let calls = 0;
  await assert.rejects(
    executeReviewTask(
      task,
      new AbortController().signal,
      async (_t: any, _p: any, options: any) => {
        calls++;
        if (_p.includes("<公开检索结果>"))
          throw new Error("search unavailable");
        return {
          text: JSON.stringify({
            markdown: "ok",
            sections: r.review.draftSections,
            evidence: [],
            findings: [],
            candidates: [],
          }),
        };
      },
      () => {},
      async () => ({ queryTitle: "Example", sources: [], candidates: [] }),
    ),
    /部分步骤/,
  );
  assert.ok(calls >= 4);
  assert.ok(
    store.rows("reviewOutputs", "review-c").some((x) => x.step === "analysis"),
  );
  assert.ok(
    store
      .rows("reviewOutputs", "review-c")
      .some((x) => x.step === "typos" && !x.partial),
  );
});
test("公开版本查询解析 arXiv 与 OpenReview，仅保留可核实标题且保留来源失败", async () => {
  const { discoverPublicVersions, parseArxivFeed } =
    await import("../server/review-discovery.ts");
  const xml =
    "<feed><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Example Research Paper</title><published>2026-08-20</published><author><name>A &amp; B</name></author><summary>test abstract</summary></entry></feed>";
  assert.equal(
    parseArxivFeed(xml)[0].url,
    "https://arxiv.org/abs/2401.00001v1",
  );
  const found = await discoverPublicVersions(
    "Example Research Paper",
    new AbortController().signal,
    async (url: string) => {
      if (url.includes("export.arxiv")) return Buffer.from(xml);
      if (url.includes("api2."))
        return Buffer.from(
          JSON.stringify({
            notes: [
              {
                id: "match",
                content: {
                  title: { value: "Example Research Paper" },
                  abstract: { value: "Summary" },
                },
              },
              { id: "wrong", content: { title: { value: "Unrelated Paper" } } },
            ],
          }),
        );
      throw new Error("503");
    },
  );
  assert.equal(found.candidates.length, 2);
  assert.ok("error" in found.sources[2]);
  assert.equal(found.sources[2].error, "503");
});
test("审稿会话兼容历史 JSON 包装但不改写正常数学文本", () => {
  assert.equal(
    store.reviewChatText(JSON.stringify({ markdown: "第一行\\n\\n- 第二行" })),
    "第一行\n\n- 第二行",
  );
  assert.equal(
    store.reviewChatText(String.raw`公式 $\nabla f$`),
    String.raw`公式 $\nabla f$`,
  );
});
test.after(async () => {
  await app.close();
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
});
