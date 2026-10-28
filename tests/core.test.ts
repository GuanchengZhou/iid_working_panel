import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(path.join(tmpdir(), "iid-tests-"));
process.env.IID_DATA_DIR = dir;
const store = await import("../server/db.ts");
const imports = await import("../server/import.ts");
const review = await import("../server/openreview.ts");
function pdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream =
    "BT /F1 20 Tf 60 720 Td (Test Research Paper) Tj /F1 12 Tf 0 -40 Td (Abstract: A test paper for durable reading annotations and AI context.) Tj ET";
  objects.push(
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  );
  objects.push("<< /Title (Test Research Paper) /Author (IID Test) >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
test("PDF import validates content, extracts physical pages and deduplicates by hash and identifier", async () => {
  await assert.rejects(
    imports.importPDF(Buffer.from("not pdf"), "bad.pdf"),
    /有效 PDF/,
  );
  const result = await imports.importPDF(pdfFixture(), "test.pdf", {
    identifier: "arxiv:1234.56789",
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.paper.title, "Test Research Paper");
  assert.equal(result.paper.authors, "IID Test");
  assert.equal(result.paper.pageCount, 1);
  assert.match(result.paper.pages[0], /durable reading/);
  const same = await imports.importPDF(pdfFixture(), "renamed.pdf");
  assert.equal(same.duplicate, true);
  assert.equal(same.paper.id, result.paper.id);
  const identifier = await imports.importPDF(
    Buffer.concat([pdfFixture(), Buffer.from("\n")]),
    "version.pdf",
    { identifier: "arxiv:1234.56789" },
  );
  assert.equal(identifier.duplicate, true);
});
test("notes, normalized annotations, session history and analysis snapshot associations survive reopening", () => {
  const p = store.all("papers")[0];
  store.save("papers", {
    ...p,
    note: "## Notes\n[page](paper-page:1)",
    lastPage: 1,
    manualScore: 4,
  });
  const a = store.save("annotations", {
    paperId: p.id,
    page: 1,
    text: "test",
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
    comment: "keep",
    color: "green",
  });
  const c = store.save("chats", {
    paperId: p.id,
    sessionId: "explicit-session",
  });
  store.save("messages", {
    paperId: p.id,
    chatId: c.id,
    role: "user",
    content: "What is new?",
  });
  const snapshot = store.save("snapshots", {
    paperId: p.id,
    notes: [{ id: "real-note", content: { rating: "6: Accept" } }],
  });
  const analysis = store.save("analyses", {
    paperId: p.id,
    snapshotId: snapshot.id,
    type: "openreview",
    references: [{ noteId: "real-note" }],
  });
  const reopened = new DatabaseSync(path.join(dir, "workbench.sqlite"));
  const fromDisk = (table: string, id: string) =>
    JSON.parse(
      (reopened.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id) as any)
        .body,
    );
  assert.equal(fromDisk("papers", p.id).manualScore, 4);
  assert.match(fromDisk("papers", p.id).note, /page/);
  assert.equal(fromDisk("annotations", a.id).rects[0].x, 0.1);
  assert.equal(fromDisk("chats", c.id).sessionId, "explicit-session");
  assert.equal(
    fromDisk("snapshots", fromDisk("analyses", analysis.id).snapshotId).notes[0]
      .id,
    "real-note",
  );
  reopened.close();
});
test("restart interrupts active and queued jobs, preserving waiting and terminal states", () => {
  const ids = [
    "running",
    "queued",
    "waiting_url",
    "waiting_selection",
    "completed",
    "failed",
  ].map((status) => store.save("tasks", { status, type: "paper" }).id);
  store.recoverTasks();
  assert.deepEqual(
    ids.map((id) => store.get("tasks", id).status),
    [
      "interrupted",
      "interrupted",
      "waiting_url",
      "waiting_selection",
      "completed",
      "failed",
    ],
  );
});
test("OpenReview v1 and v2 normalization preserves rating scales, role, signatures and source link", () => {
  const old = review.normalizeNote({
    id: "review1",
    forum: "submission",
    invitation: "ICLR/2022/Submission1/-/Official_Review",
    content: { rating: "6: Accept", confidence: "3" },
    signatures: ["Reviewer_1"],
  });
  const modern = review.normalizeNote({
    id: "meta",
    forum: "submission",
    invitations: ["ICLR/2026/Submission1/-/Meta_Review"],
    content: { recommendation: { value: "Accept" } },
  });
  assert.equal(old.kind, "review");
  assert.equal(old.content.rating, "6: Accept");
  assert.match(old.url, /noteId=review1/);
  assert.equal(modern.kind, "meta-review");
  assert.equal(modern.content.recommendation, "Accept");
  assert.equal(
    review.normalizeNote({ invitations: ["venue/-/Decision"], content: {} })
      .kind,
    "decision",
  );
  assert.equal(
    review.normalizeNote({ invitations: ["venue/-/Rebuttal"], content: {} })
      .kind,
    "response",
  );
});
test("source handling rejects private URLs and ambiguous paper identities", async () => {
  assert.equal(
    imports.parseSource("https://arxiv.org/abs/1706.03762v2").identifier,
    "arxiv:1706.03762",
  );
  assert.equal(
    imports.parseSource("https://openreview.net/forum?id=abcd").url,
    "https://openreview.net/pdf?id=abcd",
  );
  assert.throws(() => review.forumId("https://evil.example/forum?id=a"));
  await assert.rejects(imports.publicURL("http://127.0.0.1/private"));
  await assert.rejects(imports.publicURL("http://[::1]/private"));
  await assert.rejects(imports.publicURL("file:///etc/passwd"));
  assert.ok(
    review.titleMatches(
      "Attention Is All You Need",
      "Attention is all you need!",
    ),
  );
  assert.equal(
    review.titleMatches(
      "Attention Is All You Need",
      "Unrelated Tensor Inverse Problems",
    ),
    false,
  );
});
test("Codex transport retry errors do not invalidate a later successful turn; structured output uses the final message", async () => {
  const { CodexEventState } = await import("../server/codex-events.ts");
  const state = new CodexEventState(true);
  state.accept({ type: "thread.started", thread_id: "explicit-id" });
  state.accept({ type: "error", message: "Reconnecting... 5/5" });
  state.accept({
    type: "item.completed",
    item: { id: "comment", type: "agent_message", text: "Analyzing" },
  });
  state.accept({
    type: "item.completed",
    item: { id: "final", type: "agent_message", text: '{"score":4}' },
  });
  assert.equal(state.successful(0), false);
  state.accept({ type: "turn.completed" });
  assert.equal(state.successful(0), true);
  assert.equal(state.error, "");
  assert.equal(state.text, '{"score":4}');
  assert.equal(state.sessionId, "explicit-id");
  const failed = new CodexEventState();
  failed.accept({
    type: "turn.failed",
    error: { message: "Permission denied" },
  });
  assert.equal(failed.successful(1), false);
  assert.equal(failed.error, "Permission denied");
});
test.after(() => {
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
