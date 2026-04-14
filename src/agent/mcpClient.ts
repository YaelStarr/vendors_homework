import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpConnection = {
  client: Client;
  transport: StdioClientTransport;
};

export const connectMcpStdio = async (args: {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
}) => {
  const transport = new StdioClientTransport({
    command: args.command,
    args: args.args,
    cwd: args.cwd,
    env: args.env,
    stderr: "inherit",
  });

  const client = new Client({ name: "vendors-agent-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport } satisfies McpConnection;
};

export const listMcpTools = async (conn: McpConnection): Promise<McpTool[]> => {
  const res = await conn.client.listTools();
  return (res.tools ?? []).map((t: any) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
};

export const callMcpTool = async (conn: McpConnection, name: string, input: unknown) => {
  const res = await conn.client.callTool({ name, arguments: input as any });
  // Our server always returns { content: [{ type: "text", text: "...json..." }] }
  const chunks = Array.isArray(res.content) ? res.content : [];
  const textParts = chunks
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text);
  return { raw: res, text: textParts.join("\n") };
};

export const closeMcp = async (conn: McpConnection) => {
  await conn.client.close();
};

