import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  renameSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const root = process.cwd(),
  data = path.resolve(process.env.IID_DATA_DIR || "data"),
  cmd = process.argv[2],
  stamp = new Date().toISOString().replace(/[:.]/g, "-");
function run(args: string[]) {
  const r = spawnSync("/usr/bin/tar", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error("归档操作失败");
}
if (cmd === "backup") {
  if (!existsSync(path.join(data, "workbench.sqlite")))
    throw new Error("尚无可备份的数据");
  mkdirSync("backups", { recursive: true });
  // Server-side imports, notes and AI jobs must be quiet for a consistent file/database snapshot.
  const active = spawnSync(
    "/usr/bin/curl",
    [
      "-fsS",
      "--max-time",
      "2",
      `http://127.0.0.1:${process.env.IID_PORT || 4317}/api/tasks`,
    ],
    { encoding: "utf8" },
  );
  if (active.status === 0)
    throw new Error("请先停止平台服务后再备份，以保证数据库与附件一致");
  const lock = path.join(data, ".backup-lock");
  writeFileSync(lock, stamp, { flag: "wx" });
  try {
    const db = new DatabaseSync(path.join(data, "workbench.sqlite"));
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    const output = path.resolve("backups", `iid-${stamp}.tar.gz`);
    run(["-czf", output, "-C", path.dirname(data), path.basename(data)]);
    console.log(`备份已保存：${output}`);
  } finally {
    rmSync(lock, { force: true });
  }
} else if (cmd === "restore") {
  const archive = process.argv[3];
  if (!archive || !existsSync(archive))
    throw new Error("用法：npm run restore -- /完整路径/备份文件.tar.gz");
  const active = spawnSync(
    "/usr/bin/curl",
    [
      "-fsS",
      "--max-time",
      "2",
      `http://127.0.0.1:${process.env.IID_PORT || 4317}/api/health`,
    ],
    { encoding: "utf8" },
  );
  if (active.status === 0) throw new Error("恢复前请停止平台服务");
  const listing = spawnSync("/usr/bin/tar", ["-tzf", path.resolve(archive)], {
    encoding: "utf8",
  });
  if (listing.status !== 0) throw new Error("备份文件无效");
  const names = listing.stdout.split("\n").filter(Boolean),
    top = path.basename(data);
  if (
    names.some(
      (n) =>
        n.startsWith("/") ||
        n.split("/").includes("..") ||
        n.split("/")[0] !== top,
    )
  )
    throw new Error(`归档必须仅包含 ${top}/ 目录`);
  const types = spawnSync("/usr/bin/tar", ["-tvzf", path.resolve(archive)], {
    encoding: "utf8",
  });
  if (
    types.status !== 0 ||
    types.stdout
      .split("\n")
      .filter(Boolean)
      .some((line) => !["-", "d"].includes(line[0]))
  )
    throw new Error("备份不能包含链接或特殊文件");
  const temp = path.join(root, `.restore-${stamp}`);
  mkdirSync(temp);
  try {
    run(["-xzf", path.resolve(archive), "-C", temp]);
    const restored = path.join(temp, top);
    if (!existsSync(path.join(restored, "workbench.sqlite")))
      throw new Error("备份不包含数据库");
    rmSync(path.join(restored, ".backup-lock"), { force: true });
    const check = new DatabaseSync(path.join(restored, "workbench.sqlite"));
    const result = check.prepare("PRAGMA integrity_check").get() as any;
    check.close();
    if (result.integrity_check !== "ok")
      throw new Error("备份数据库未通过完整性检查");
    if (existsSync(data)) {
      const previous = data + `.before-restore-${stamp}`;
      renameSync(data, previous);
      console.log("恢复前数据已保留：" + previous);
    }
    renameSync(restored, data);
    console.log("已恢复：" + data);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
} else throw new Error("支持 backup 或 restore");
