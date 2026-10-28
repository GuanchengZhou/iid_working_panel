import { all, get, save, transaction } from "./db.ts";
import { validateSelection } from "./assistant-settings.ts";
export const REVIEW_STEPS = [
  "discover",
  "analysis",
  "initial",
  "typos",
  "compare",
  "draft",
  "validate",
  "polish",
  "chat",
] as const;
export const stepLabels: Record<string, string> = {
  discover: "公开版本查找",
  analysis: "论文分析",
  initial: "初步审稿",
  typos: "typo 检查",
  compare: "版本比较",
  draft: "生成审稿草稿",
  validate: "合理性检查",
  polish: "润色",
  chat: "审稿会话",
};
export const defaultSections = [
  "Summary",
  "Strengths",
  "Weaknesses",
  "Questions",
];
export const templates = [
  {
    id: "general",
    name: "通用审稿",
    sections: defaultSections,
    scoreFields: [],
  },
  {
    id: "iclr",
    name: "ICLR · 历史结构参考",
    sections: defaultSections,
    scoreFields: [
      "Soundness",
      "Presentation",
      "Contribution",
      "Rating",
      "Confidence",
    ],
  },
  {
    id: "icml",
    name: "ICML · 历史结构参考",
    sections: defaultSections,
    scoreFields: [
      "Soundness",
      "Presentation",
      "Significance",
      "Originality",
      "Rating",
      "Confidence",
    ],
  },
  {
    id: "neurips",
    name: "NeurIPS · 历史结构参考",
    sections: [
      "Summary",
      "Strengths",
      "Weaknesses",
      "Questions",
      "Limitations",
    ],
    scoreFields: [
      "Quality",
      "Clarity",
      "Significance",
      "Originality",
      "Rating",
      "Confidence",
    ],
  },
  {
    id: "journal",
    name: "期刊 · 历史结构参考",
    sections: [
      "Summary",
      "Strengths",
      "Weaknesses",
      "Questions",
      "Major Concerns",
      "Minor Concerns",
    ],
    scoreFields: ["Overall Recommendation"],
  },
];
export const styleGuide =
  "简洁准确地总结论文；优点具体且有依据；质疑按编号表述，说明问题、依据、影响及作者可如何澄清。重点检查理论是否支撑 claimed 优势，条件与适用范围，实验公平性、基线与消融、数据一致性、符号定义与可复现性。保持专业、克制且建设性。不模仿历史私人备注、具体立场或评分。";
export function requireReview(id: string) {
  const r = get("reviewCases", id);
  if (!r) throw new Error("审稿任务不存在");
  return r;
}
export function rows(table: Parameters<typeof all>[0], id: string) {
  return all(table).filter((x) => x.reviewId === id);
}
export function requireDocument(id: string, documentId?: string) {
  const r = requireReview(id);
  const d = get("reviewDocuments", documentId || r.documentId);
  if (!d || d.reviewId !== id) throw new Error("稿件不属于当前审稿任务");
  return d;
}
export function defaultReviewSettings() {
  return Object.fromEntries(
    REVIEW_STEPS.map((s) => [
      s,
      { model: "gpt-6-luna", reasoningEffort: "medium" },
    ]),
  );
}
export function reviewSettings(input: any) {
  const next = defaultReviewSettings();
  for (const s of REVIEW_STEPS)
    if (input?.[s]) next[s] = validateSelection(input[s]);
  return next;
}
export function sections(value: any) {
  if (!Array.isArray(value) || !value.length || value.length > 30)
    throw new Error("至少保留一个章节，最多30个");
  return value.map((s: any) => {
    if (
      typeof s.id !== "string" ||
      typeof s.heading !== "string" ||
      !s.heading.trim() ||
      s.heading.length > 150 ||
      typeof s.content !== "string" ||
      s.content.length > 200000
    )
      throw new Error("章节格式无效");
    return { id: s.id, heading: s.heading.trim(), content: s.content };
  });
}
export function markdown(ss: any[]) {
  return ss.map((s) => `## ${s.heading}\n\n${s.content}`).join("\n\n");
}
function writeDraft(id: string, body: any, kind = "edit") {
  const r = requireReview(id);
  if (body.expectedRevision !== r.draftRevision)
    throw new Error("草稿已更新，请刷新后再保存，避免覆盖其他修改");
  const next = sections(body.sections);
  if (new Set(next.map((s: any) => s.id)).size !== next.length)
    throw new Error("章节标识重复");
  save("reviewDraftVersions", {
    reviewId: id,
    revision: r.draftRevision,
    sections: r.draftSections,
    kind,
    scores: r.scores,
  });
  return save("reviewCases", {
    ...r,
    draftSections: next,
    draftRevision: r.draftRevision + 1,
  });
}
export function saveDraft(id: string, body: any, kind = "edit") {
  return transaction(() => writeDraft(id, body, kind));
}
export function applyCandidate(id: string, outputId: string, body: any) {
  return transaction(() => {
    const r = requireReview(id);
    const out = get("reviewOutputs", outputId);
    if (
      !out ||
      out.reviewId !== id ||
      !["draft", "initial", "polish"].includes(out.step) ||
      !Array.isArray(out.sections)
    )
      throw new Error("不是当前任务的草稿候选");
    if (out.documentId !== r.documentId)
      throw new Error("候选基于其他稿件版本，不能采用");
    if (
      out.input?.draftRevision !== r.draftRevision &&
      out.lastAppliedRevision !== r.draftRevision
    )
      throw new Error("候选基于旧草稿；请重新生成，或复制选中的文本到当前稿");
    if (
      out.step === "draft" &&
      out.input?.issueRevision !== undefined &&
      out.input.issueRevision !== r.issueRevision
    )
      throw new Error("候选基于旧问题备忘，请重新生成");
    const selected = body.sectionIds;
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.some((s: any) => !out.sections.some((x: any) => x.id === s))
    )
      throw new Error("请选择候选章节");
    const next = r.draftSections.map((s: any) =>
      selected.includes(s.id)
        ? out.sections.find((x: any) => x.id === s.id)
        : s,
    );
    for (const s of out.sections)
      if (selected.includes(s.id) && !next.some((x: any) => x.id === s.id))
        next.push(s);
    const updated = writeDraft(
      id,
      { expectedRevision: body.expectedRevision, sections: next },
      "adopt",
    );
    save("reviewOutputs", {
      ...out,
      lastAppliedRevision: updated.draftRevision,
    });
    return updated;
  });
}
export function snapshotInput(id: string) {
  const r = requireReview(id),
    d = requireDocument(id);
  return {
    review: structuredClone(r),
    document: structuredClone(d),
    issues: rows("reviewIssues", id).filter((x) => !x.removed),
    outputs: rows("reviewOutputs", id)
      .filter(
        (x) => x.documentId === d.id && !["discover", "chat"].includes(x.step),
      )
      .slice(0, 16),
    draftRevision: r.draftRevision,
    issueRevision: r.issueRevision,
    documentId: d.id,
    pdfHash: d.hash,
  };
}

export function reviewChatText(text: string): string {
  try {
    const value = JSON.parse(text);
    if (typeof value.markdown === "string")
      return value.markdown.replace(/\\n(?=\\n|[-*#\s]|$)/g, "\n");
  } catch {}
  return text;
}
