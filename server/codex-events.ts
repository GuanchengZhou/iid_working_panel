/** CLI emits recoverable transport errors before HTTPS fallback succeeds. */
export class CodexEventState {
  sessionId?: string;
  error = "";
  completed = false;
  private messages = new Map<string, string>();
  constructor(
    public structured = false,
    sessionId?: string,
  ) {
    this.sessionId = sessionId;
  }
  accept(e: any) {
    if (e.type === "thread.started") this.sessionId = e.thread_id;
    if (e.type === "error" || e.type === "turn.failed")
      this.error = e.message || e.error?.message || JSON.stringify(e);
    if (e.type === "turn.completed") {
      this.completed = true;
      this.error = "";
    }
    if (e.type === "item.completed" && e.item?.type === "agent_message")
      this.messages.set(
        e.item.id || String(this.messages.size),
        e.item.text || "",
      );
  }
  get text() {
    const messages = [...this.messages.values()];
    return this.structured ? messages.at(-1) || "" : messages.join("\n\n");
  }
  successful(exitCode: number | null) {
    return exitCode === 0 && this.completed && !this.error && !!this.text;
  }
}
