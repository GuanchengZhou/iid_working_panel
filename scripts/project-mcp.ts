import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "iid-project-sources", version: "1.0.0" });
async function call(name: string, args: any) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.IID_PORT || 4317}/api/project-tools`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.IID_PROJECT_TOKEN,
        },
        body: JSON.stringify({ name, args }),
        signal: AbortSignal.timeout(90000),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取失败");
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  } catch (e: any) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: e.message }],
    };
  }
}
server.registerTool(
  "list_sources",
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: "列出当前授权项目的资料及其活跃状态。只读，不跨项目。",
  },
  () => call("list_sources", {}),
);
server.registerTool(
  "read_source",
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "读取资料快照，refresh=true 可重新采集；定时检查仅可刷新活跃资料。",
    inputSchema: { sourceId: z.string(), refresh: z.boolean().optional() },
  },
  (args) => call("read_source", args),
);
server.registerTool(
  "read_web_link",
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: "追加读取已绑定网页同源的只读链接；FSPE 仅允许当前主线接口。",
    inputSchema: { sourceId: z.string(), url: z.string() },
  },
  (args) => call("read_web_link", args),
);
server.registerTool(
  "read_local_file",
  {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: "读取已绑定本地目录内的一个相对路径，拒绝越界和符号链接逃逸。",
    inputSchema: { sourceId: z.string(), relativePath: z.string() },
  },
  (args) => call("read_local_file", args),
);
server.registerTool(
  "get_project",
  {
    description: "读取当前项目用户维护的名称、目标描述、备注及最新 updatedAt。",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  () => call("get_project", {}),
);
if (process.env.IID_PROJECT_WRITE === "1") {
  server.registerTool(
    "update_project",
    {
      description:
        "用户要求润色或修改时，保存本项目的名称、目标描述、备注或助手名称。保留修改前后记录。不能改优先级、自动跟进或事项。",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        expectedUpdatedAt: z.string(),
        patch: z
          .object({
            name: z.string().optional(),
            goal: z.string().optional(),
            notes: z.string().optional(),
            assistantName: z.string().optional(),
          })
          .strict(),
      },
    },
    (args) => call("update_project", args),
  );
  server.registerTool(
    "update_material",
    {
      description:
        "用户要求整理资料时，编辑已绑定资料标题、说明、分类、标签；不能修改资料原件、地址或活跃状态。",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
        sourceId: z.string(),
        expectedUpdatedAt: z.string(),
        patch: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            category: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .strict(),
      },
    },
    (args) => call("update_material", args),
  );
}
await server.connect(new StdioServerTransport());
