import { useEffect, useState } from "react";
import { api } from "./types";
import "./assistant-controls.css";
export default function AssistantControls({
  onError,
}: {
  onError: (s: string) => void;
}) {
  const [settings, setSettings] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api("/assistant-settings")
        .then((v) => {
          if (alive) setSettings(v);
        })
        .catch((e) => onError(e.message));
    load();
    window.addEventListener("iid-assistant-settings", load);
    const events = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout>;
    events.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    return () => {
      alive = false;
      events.close();
      clearTimeout(timer);
      window.removeEventListener("iid-assistant-settings", load);
    };
  }, [onError]);
  async function change(patch: any) {
    setBusy(true);
    try {
      const next = await api("/assistant-settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSettings(next);
      window.dispatchEvent(new Event("iid-assistant-settings"));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!settings) return <div className="assistant-controls">加载助手设置…</div>;
  return (
    <div className="assistant-controls">
      <div>
        <label>
          模型
          <select
            aria-label="助手模型"
            disabled={busy}
            value={settings.model}
            onChange={(e) => void change({ model: e.target.value })}
          >
            {settings.models.map((m: string) => (
              <option key={m} value={m}>
                {m === "gpt-6.1-sol" ? "6.1-sol" : "6-luna"}
              </option>
            ))}
          </select>
        </label>
        <label>
          思考强度
          <select
            aria-label="助手思考强度"
            disabled={busy}
            value={settings.reasoningEffort}
            onChange={(e) => void change({ reasoningEffort: e.target.value })}
          >
            {settings.reasoningEfforts.map((v: string) => (
              <option key={v} value={v}>
                {
                  (
                    {
                      low: "低",
                      medium: "中",
                      high: "高",
                      xhigh: "更高",
                      max: "最高",
                    } as any
                  )[v]
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      <small>
        {busy
          ? "正在保存…"
          : "全局默认已保存 · 新任务生效，运行中任务保持原设置"}
      </small>
    </div>
  );
}
