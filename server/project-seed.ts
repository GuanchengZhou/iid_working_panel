import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DATA, all, save } from "./db.ts";
import { createMaterial } from "./materials.ts";
import { projectRows } from "./project-store.ts";

const configSchema = z.object({
  project: z
    .object({
      seedKey: z.string().min(1).max(200),
      name: z.string().min(1).max(200),
      goal: z.string().max(200000).optional(),
      notes: z.string().max(200000).optional(),
    })
    .passthrough(),
  materials: z
    .array(
      z
        .object({ seedKey: z.string().min(1).max(200), kind: z.string() })
        .passthrough(),
    )
    .max(100),
  runInitialCheck: z.boolean().default(false),
});

/** Optional local bootstrap configuration, stored with private app data, never in source. */
export async function seedFSPE(enqueue: (id: string) => any) {
  if (process.env.IID_SKIP_SEED === "1") return;
  const file =
    process.env.IID_PROJECT_SEED_FILE ||
    path.join(DATA, "local-project-seed.json");
  if (!existsSync(file)) return;
  const config = configSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  let project = all("projects").find(
    (p) => p.seedKey === config.project.seedKey,
  );
  if (!project)
    project = save("projects", {
      priority: 1,
      status: "active",
      archived: false,
      autoFollowEnabled: false,
      nextCheckAt: null,
      health: "unknown",
      headline: "等待首次检查",
      assistantName: "项目助手",
      ...config.project,
    });
  for (const item of config.materials) {
    if (
      projectRows("materials", project.id).some(
        (m) => m.seedKey === item.seedKey,
      )
    )
      continue;
    if (
      item.kind === "local" &&
      (typeof item.path !== "string" || !existsSync(item.path))
    )
      continue;
    const { seedKey, sourceUrl, ...body } = item;
    const material = await createMaterial(project.id, body);
    save("materials", {
      ...material,
      seedKey,
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }
  if (
    config.runInitialCheck &&
    !project.initialReviewTaskId &&
    !projectRows("projectReports", project.id).length
  ) {
    const task = enqueue(project.id);
    save("projects", {
      ...all("projects").find((p) => p.id === project.id),
      initialReviewTaskId: task.id,
    });
  }
}
