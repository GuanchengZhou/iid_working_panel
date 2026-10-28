import { downloadReviewVersion } from "./review-discovery.ts";
import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DATA, all, get, save, transaction } from "./db.ts";
import { importPDF, download, parseSource, linkMetadata } from "./import.ts";
import {
  requireReview,
  requireDocument,
  rows,
  templates,
  defaultSections,
  defaultReviewSettings,
  reviewSettings,
  saveDraft,
  applyCandidate,
  snapshotInput,
  markdown,
  REVIEW_STEPS,
  reviewChatText,
} from "./review-store.ts";
import { validateSelection } from "./assistant-settings.ts";
const text = z.string().max(200000),
  short = z.string().max(500),
  status = z.enum(["unread", "reviewing", "drafted", "archived"]);
const rect = z.object({
  x: z.number().min(0).max(1.01),
  y: z.number().min(0).max(1.01),
  width: z.number().min(0).max(1.01),
  height: z.number().min(0).max(1.01),
});
export function registerReviews(
  app: FastifyInstance,
  enqueue: any,
  emit: () => void,
) {
  const scope = (
    table: Parameters<typeof all>[0],
    reviewId: string,
    id: string,
  ) => {
    requireReview(reviewId);
    const x = get(table, id);
    if (!x || x.reviewId !== reviewId)
      throw new Error("记录不属于当前审稿任务");
    return x;
  };
  const detail = (id: string) => {
    const r = requireReview(id);
    return {
      ...r,
      document: requireDocument(id),
      documents: rows("reviewDocuments", id).map(({ pages, ...d }) => d),
      issues: rows("reviewIssues", id).filter((x) => !x.removed),
      annotations: rows("reviewAnnotations", id),
      outputs: rows("reviewOutputs", id).map((o) =>
        o.step === "chat" ? { ...o, markdown: reviewChatText(o.markdown) } : o,
      ),
      history: rows("reviewDraftVersions", id),
      tasks: all("tasks")
        .filter((x) => x.reviewId === id)
        .map(({ input, comparison, chatHistory, ...t }) => t),
    };
  };
  function start(id: string, b: any) {
    const r = requireReview(id),
      step = b.step;
    if (step !== "all" && !REVIEW_STEPS.includes(step))
      throw new Error("未知审稿步骤");
    if (
      all("tasks").some(
        (t) => t.reviewId === id && ["running", "queued"].includes(t.status),
      )
    )
      throw new Error("当前审稿已有任务运行，请等待或取消");
    if (r.status === "unread")
      save("reviewCases", { ...r, status: "reviewing" });
    const input = snapshotInput(id),
      selection = validateSelection(
        b.selection || r.stepSettings[step === "all" ? "analysis" : step],
      );
    if (
      ["draft", "validate", "polish"].includes(step) &&
      !input.outputs.some((x) => x.step === "analysis")
    )
      throw new Error("请先完成论文分析");
    if (
      ["validate", "polish"].includes(step) &&
      !r.draftSections.some((s: any) => s.content.trim())
    )
      throw new Error("请先编辑或采用一份审稿草稿");
    const comparison =
      step === "compare" ? requireDocument(id, b.comparisonId) : undefined;
    if (comparison?.id === r.documentId) throw new Error("请选择其他公开版本");
    const message = step === "chat" ? text.min(1).parse(b.message) : undefined;
    const settings = structuredClone(r.stepSettings);
    if (b.selection && step !== "all") settings[step] = selection;
    const task = enqueue(
      step === "all" ? "review_initial" : "review_step",
      undefined,
      {
        reviewId: id,
        step,
        stepSettings: settings,
        ...selection,
        input,
        comparison,
        message,
        chatHistory:
          step === "chat"
            ? rows("reviewOutputs", id)
                .filter((o) => o.step === "chat")
                .slice(0, 12)
                .reverse()
                .map((o) => ({ user: o.userMessage, assistant: o.markdown }))
            : undefined,
      },
    );
    emit();
    return task;
  }
  app.get("/api/reviews/templates", async () => templates);
  app.get("/api/reviews", async () =>
    all("reviewCases")
      .map((r) => ({
        ...r,
        document: requireDocument(r.id),
        issueCount: rows("reviewIssues", r.id).filter(
          (x) => !x.removed && x.status !== "resolved",
        ).length,
      }))
      .map((r) => ({ ...r, document: { ...r.document, pages: undefined } })),
  );
  app.post("/api/reviews/import", async (req) => {
    const results: any[] = [];
    for await (const file of req.files())
      try {
        const buf = await file.toBuffer(),
          hash = createHash("sha256").update(buf).digest("hex");
        const existing = all("reviewDocuments").find(
          (d) => d.hash === hash && get("reviewCases", d.reviewId),
        );
        if (existing) {
          results.push({
            filename: file.filename,
            reviewId: existing.reviewId,
            duplicate: true,
          });
          continue;
        }
        const id = randomUUID();
        const { paper: d } = await importPDF(
          buf,
          file.filename,
          { reviewId: id },
          "reviewDocuments",
        );
        save("reviewCases", {
          id,
          title: d.title,
          venue: "",
          deadline: "",
          status: "unread",
          documentId: d.id,
          requirements: "",
          templateId: "general",
          analysisLanguage: "中文",
          reviewLanguage: "English",
          stepSettings: defaultReviewSettings(),
          draftSections: defaultSections.map((heading, i) => ({
            id: `section-${i}`,
            heading,
            content: "",
          })),
          draftRevision: 0,
          issueRevision: 0,
          settingsRevision: 0,
          scoreScales: "",
          scores: {},
        });
        results.push({
          filename: file.filename,
          reviewId: id,
          duplicate: false,
        });
      } catch (e: any) {
        results.push({ filename: file.filename, error: e.message });
      }
    emit();
    return results;
  });
  app.get<{ Params: { id: string } }>("/api/reviews/:id", async (req) =>
    detail(req.params.id),
  );
  app.patch<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id",
    async (req) => {
      const r = requireReview(req.params.id);
      const p = z
        .object({
          title: short.min(1).optional(),
          venue: short.optional(),
          deadline: z
            .string()
            .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          status: status.optional(),
          requirements: text.optional(),
          analysisLanguage: z.enum(["中文", "English"]).optional(),
          reviewLanguage: z.enum(["中文", "English"]).optional(),
          templateId: z.string().optional(),
          scoreScales: text.optional(),
          scores: z
            .record(z.string().max(100), z.string().max(1000))
            .optional(),
          stepSettings: z.any().optional(),
          expectedSettingsRevision: z.number().int().optional(),
        })
        .strict()
        .parse(req.body);
      if (
        p.expectedSettingsRevision !== undefined &&
        p.expectedSettingsRevision !== r.settingsRevision
      )
        throw new Error("设置已更新，请刷新");
      const { expectedSettingsRevision, ...patch } = p;
      if (p.templateId && !templates.some((t) => t.id === p.templateId))
        throw new Error("模板不存在");
      if (p.stepSettings) patch.stepSettings = reviewSettings(p.stepSettings);
      const template = templates.find((t) => t.id === p.templateId);
      const templateDraft =
        template &&
        r.draftSections.every((s: any) => !s.content.trim()) &&
        r.draftRevision === 0
          ? {
              draftSections: template.sections.map((heading, i) => ({
                id: `section-${i}`,
                heading,
                content: "",
              })),
            }
          : {};
      const result = save("reviewCases", {
        ...r,
        ...patch,
        ...templateDraft,
        settingsRevision: r.settingsRevision + 1,
      });
      emit();
      return result;
    },
  );
  app.get<{ Params: { id: string; docId: string } }>(
    "/api/reviews/:id/documents/:docId/pdf",
    async (req, reply) => {
      const d = requireDocument(req.params.id, req.params.docId);
      return reply
        .type("application/pdf")
        .header("Content-Disposition", 'inline; filename="manuscript.pdf"')
        .send(createReadStream(path.join(DATA, "pdfs", d.file)));
    },
  );
  app.patch<{ Params: { id: string; docId: string }; Body: any }>(
    "/api/reviews/:id/documents/:docId/position",
    async (req) => {
      const d = requireDocument(req.params.id, req.params.docId),
        b = z
          .object({
            lastPage: z.number().min(1).max(d.pageCount).optional(),
            zoom: z.number().min(0.5).max(2).optional(),
          })
          .parse(req.body);
      return save("reviewDocuments", { ...d, ...b });
    },
  );
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id/tasks",
    async (req) => start(req.params.id, req.body),
  );
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id/versions",
    async (req) => {
      const id = req.params.id;
      requireReview(id);
      const b = z
        .object({
          url: z.string().url().max(2000),
          outputId: z.string().optional(),
        })
        .parse(req.body);
      if (b.outputId) {
        const out = scope("reviewOutputs", id, b.outputId);
        if (
          out.step !== "discover" ||
          !out.candidates.some((c: any) => c.url === b.url)
        )
          throw new Error("链接不是已找到的候选");
      }
      save("reviewCases", {
        ...requireReview(id),
        pendingVersionUrl: b.url,
        versionImportError: null,
      });
      emit();
      const src = parseSource(b.url);
      const [buf, meta] = await Promise.all([
        downloadReviewVersion(src.url),
        Promise.race([
          linkMetadata(b.url),
          new Promise<Record<string, string>>((resolve) =>
            setTimeout(() => resolve({}), 10000).unref(),
          ),
        ]),
      ]).catch((e: any) => {
        save("reviewCases", {
          ...requireReview(id),
          versionImportError: e.message || "公开稿下载失败",
        });
        emit();
        throw e;
      });
      const imported = await importPDF(
        buf,
        "public-version.pdf",
        { ...src, ...meta, sourceUrl: b.url, reviewId: id },
        "reviewDocuments",
      );
      const isCurrent = imported.paper.id === requireReview(id).documentId;
      const doc = save("reviewDocuments", {
        ...imported.paper,
        ...(isCurrent
          ? { id: randomUUID(), sameAsDocumentId: imported.paper.id }
          : {}),
        sourceUrl: b.url,
        role: "public",
        confirmedAt: new Date().toISOString(),
      });
      emit();
      save("reviewCases", { ...requireReview(id), versionImportError: null });
      return {
        documentId: doc.id,
        task: start(id, { step: "compare", comparisonId: doc.id }),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/reviews/:id/versions/upload",
    async (req) => {
      const id = req.params.id;
      requireReview(id);
      let buffer: Buffer | undefined,
        filename = "public-version.pdf",
        sourceUrl = "";
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (buffer) throw new Error("每次只上传一个公开版本");
          buffer = await part.toBuffer();
          filename = part.filename;
        } else if (part.fieldname === "sourceUrl")
          sourceUrl = String(part.value).slice(0, 2000);
      }
      if (!buffer) throw new Error("请选择公开版本 PDF");
      if (sourceUrl && !/^https?:\/\//.test(sourceUrl))
        throw new Error("来源网址格式不正确");
      const imported = await importPDF(
        buffer,
        filename,
        { reviewId: id, sourceUrl },
        "reviewDocuments",
      );
      const doc = save("reviewDocuments", {
        ...imported.paper,
        ...(imported.paper.id === requireReview(id).documentId
          ? { id: randomUUID(), sameAsDocumentId: imported.paper.id }
          : {}),
        sourceUrl,
        role: "public",
        source: "manual-upload",
        confirmedAt: new Date().toISOString(),
      });
      emit();
      save("reviewCases", { ...requireReview(id), versionImportError: null });
      return {
        documentId: doc.id,
        task: start(id, { step: "compare", comparisonId: doc.id }),
      };
    },
  );
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id/issues",
    async (req) => {
      const id = req.params.id,
        r = requireReview(id),
        d = requireDocument(id);
      const b = z
        .object({
          content: text.min(1),
          kind: z.enum(["location", "global"]),
          page: z.number().int().min(1).max(d.pageCount).nullable().optional(),
          quote: text.optional(),
          rects: z.array(rect).max(1000).optional(),
          category: short.optional(),
          importance: z.enum(["major", "minor"]).optional(),
          status: z.enum(["unverified", "confirmed", "resolved"]).optional(),
          include: z.boolean().optional(),
          outputId: z.string().optional(),
        })
        .strict()
        .parse(req.body);
      if (b.kind === "location" && !b.page)
        throw new Error("位置问题需要物理页码");
      if (b.outputId) scope("reviewOutputs", id, b.outputId);
      const issue = transaction(() => {
        save("reviewCases", { ...r, issueRevision: r.issueRevision + 1 });
        return save("reviewIssues", {
          reviewId: id,
          documentId: d.id,
          pdfHash: d.hash,
          quote: "",
          rects: [],
          category: "方法",
          importance: "major",
          status: "unverified",
          include: true,
          ...b,
          page: b.kind === "global" ? null : b.page,
        });
      });
      emit();
      return issue;
    },
  );
  app.patch<{ Params: { id: string; issueId: string }; Body: any }>(
    "/api/reviews/:id/issues/:issueId",
    async (req) => {
      const { id, issueId } = req.params,
        x = scope("reviewIssues", id, issueId),
        r = requireReview(id);
      const b = z
        .object({
          content: text.min(1).optional(),
          category: short.optional(),
          importance: z.enum(["major", "minor"]).optional(),
          status: z.enum(["unverified", "confirmed", "resolved"]).optional(),
          include: z.boolean().optional(),
          removed: z.boolean().optional(),
          expectedUpdatedAt: z.string(),
        })
        .strict()
        .parse(req.body);
      if (b.expectedUpdatedAt !== x.updatedAt)
        throw new Error("问题已更新，请刷新");
      const { expectedUpdatedAt, ...p } = b;
      const next = transaction(() => {
        save("reviewCases", { ...r, issueRevision: r.issueRevision + 1 });
        return save("reviewIssues", { ...x, ...p });
      });
      emit();
      return next;
    },
  );
  app.post<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id/annotations",
    async (req) => {
      const id = req.params.id,
        d = requireDocument(id);
      const b = z
        .object({
          page: z.number().int().min(1).max(d.pageCount),
          text: text,
          comment: text,
          color: z.enum(["yellow", "green", "purple"]),
          rects: z.array(rect).min(1).max(1000),
        })
        .parse(req.body);
      const x = save("reviewAnnotations", {
        reviewId: id,
        documentId: d.id,
        ...b,
      });
      emit();
      return x;
    },
  );
  app.patch<{ Params: { id: string; aId: string }; Body: any }>(
    "/api/reviews/:id/annotations/:aId",
    async (req) => {
      const x = scope("reviewAnnotations", req.params.id, req.params.aId);
      const b = z
        .object({
          comment: text.optional(),
          color: z.enum(["yellow", "green", "purple"]).optional(),
          removed: z.boolean().optional(),
        })
        .parse(req.body);
      const out = save("reviewAnnotations", { ...x, ...b });
      emit();
      return out;
    },
  );
  app.put<{ Params: { id: string }; Body: any }>(
    "/api/reviews/:id/draft",
    async (req) => {
      const out = saveDraft(req.params.id, req.body);
      emit();
      return out;
    },
  );
  app.post<{ Params: { id: string; outId: string }; Body: any }>(
    "/api/reviews/:id/outputs/:outId/adopt",
    async (req) => {
      const out = applyCandidate(req.params.id, req.params.outId, req.body);
      emit();
      return out;
    },
  );
  app.post<{ Params: { id: string; versionId: string }; Body: any }>(
    "/api/reviews/:id/history/:versionId/restore",
    async (req) => {
      const x = scope(
        "reviewDraftVersions",
        req.params.id,
        req.params.versionId,
      );
      const out = saveDraft(
        req.params.id,
        {
          expectedRevision: (req.body as any).expectedRevision,
          sections: x.sections,
        },
        "restore",
      );
      emit();
      return out;
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/reviews/:id/export",
    async (req, reply) => {
      const r = requireReview(req.params.id);
      const body = markdown(r.draftSections)
        .replace(/\[([^\]]+)\]\(paper-page:(\d+)\)/g, "$1")
        .replace(/\[([^\]]+)\]\(material:[^)]+\)/g, "$1");
      const scores = Object.entries(r.scores || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `## ${k}\n\n${v}`)
        .join("\n\n");
      return reply
        .type("text/markdown; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="review.md"')
        .send(body + (scores ? "\n\n" + scores : ""));
    },
  );
}
