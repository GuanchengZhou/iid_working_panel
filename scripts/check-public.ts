import { execFileSync } from "node:child_process";
const files = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const forbidden =
  /(^|\/)(data|backups|node_modules|dist|output|outputs|\.qa|\.codex|\.ssh|\.local)(\/|$)|(^|\/)\.env(?:\.|$)|\.(sqlite(?:3)?(?:-\w+)?|db(?:-wal|-shm)?|pdf|docx|xlsx|log|pem|key|zip|tgz|tar(?:\.gz)?)$|(^|\/)(auth|credentials)\.json$|(^|\/)验收记录\.md$|^[^/]+\.(png|jpe?g|webp)$/i;
const patterns: [string, RegExp][] = [
  ["个人绝对路径", /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  ["API secret", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["私钥", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  [
    "真实会话编号",
    /(?:codex:\/\/threads\/|thread:\/\/)[0-9a-f]{8}-[0-9a-f-]{27,}/i,
  ],
];
let failed = false;
for (const file of files) {
  if (forbidden.test(file)) {
    console.error(`${file}: 不应发布的本地资料`);
    failed = true;
    continue;
  }
  if (/\.(png|jpe?g|webp|woff2?|ttf)$/i.test(file)) continue;
  const source = execFileSync("git", ["show", ":" + file], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  for (const [label, regex] of patterns)
    if (regex.test(source)) {
      console.error(`${file}: 检出${label}，请检查`);
      failed = true;
    }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `发布检查通过：${files.length} 个暂存文件，未发现受检查规则覆盖的私密路径、令牌或资料文件。请仍人工确认内容。`,
  );
