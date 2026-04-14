import type { McpConnection, McpTool } from "./mcpClient.js";
import { callMcpTool } from "./mcpClient.js";
import type { AgentOptions, TraceEvent } from "./types.js";

type OllamaToolDef = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: string | Record<string, unknown> };
  }>;
};

const toOllamaTools = (tools: McpTool[]): OllamaToolDef[] =>
  tools.map((t) => {
    const parameters =
      t.inputSchema && typeof t.inputSchema === "object" && "type" in (t.inputSchema as object)
        ? (t.inputSchema as Record<string, unknown>)
        : { type: "object" as const, properties: {} };
    return {
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters,
      },
    };
  });

const parseToolArguments = (args: string | Record<string, unknown> | undefined): unknown => {
  if (args == null) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return {};
  }
};

const getOllamaBaseUrl = () => {
  const raw = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").trim();
  return raw.replace(/\/$/, "");
};

export const runOllamaAgent = async (args: {
  question: string;
  mcp: McpConnection;
  tools: McpTool[];
  options: AgentOptions;
}) => {
  const trace: TraceEvent[] = [];
  const baseUrl = getOllamaBaseUrl();
  const model = args.options.model;
  const maxTurns = args.options.maxTurns;
  const ollamaTools = toOllamaTools(args.tools);

  const systemPrompt =
    "You are a security analyst assistant. Answer in Hebrew.\n" +
    "Use the provided tools when needed to look up vendors/vulnerabilities.\n" +
    "If a tool call returns JSON, use it as the source of truth.\n";

  const messages: OllamaChatMessage[] = [
    { role: "user", content: `${systemPrompt}\n\nQuestion: ${args.question}` },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: ollamaTools,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama /api/chat failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      message?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string | Record<string, unknown> };
        }>;
      };
    };

    const msg = data.message;
    if (!msg) {
      const fallback = "לא התקבלה תשובה מ-Ollama.";
      trace.push({ type: "final", text: fallback });
      return { answer: fallback, trace };
    }

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = (msg.content ?? "").trim();
      trace.push({ type: "final", text });
      return { answer: text || "(ריק)", trace };
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      const input = parseToolArguments(tc.function?.arguments);
      trace.push({ type: "tool_call", name, input });
      const result = await callMcpTool(args.mcp, name, input);
      trace.push({ type: "tool_result", name, outputText: result.text });
      messages.push({
        role: "tool",
        name,
        content: result.text,
      });
    }
  }

  const fallback = "לא הצלחתי לסיים תשובה במסגרת מספר הסבבים המותר. נסי לשאול בצורה מצומצמת יותר.";
  trace.push({ type: "final", text: fallback });
  return { answer: fallback, trace };
};
