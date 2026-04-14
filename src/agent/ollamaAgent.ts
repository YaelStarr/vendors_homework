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

const isMcpToolErrorText = (text: string) => {
  const t = text.toLowerCase();
  return t.startsWith("mcp error") || t.includes("input validation error") || t.includes("error -32602");
};

const coerceNumericArgs = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const numericKeys = ["limit", "offset", "min_cvss", "max_cvss", "founded"];
  for (const k of numericKeys) {
    const v = out[k];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0 && /^-?\d+(\.\d+)?$/.test(trimmed)) {
        const n = Number(trimmed);
        if (Number.isFinite(n)) out[k] = n;
      }
    }
  }
  return out;
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
  let lastTurnHadToolError = false;

  const systemPrompt =
    "You are a security analyst assistant. Answer in Hebrew.\n" +
    "Use the provided tools when needed to look up vendors/vulnerabilities.\n" +
    "If a tool call returns JSON, use it as the source of truth.\n" +
    "If the user asks relative time ranges (e.g. 'last year', 'past 30 days', 'בשנה האחרונה'), call get_current_date first and derive explicit YYYY-MM-DD bounds.\n";

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
      if (lastTurnHadToolError) {
        messages.push({ role: "assistant", content: msg.content ?? "" });
        messages.push({
          role: "user",
          content:
            "Your previous tool call failed (validation or execution error). " +
            "You MUST call the relevant tool again with corrected arguments (e.g. limit must be >= 1). " +
            "Do not guess or answer from memory until you have a successful tool result.",
        });
        lastTurnHadToolError = false;
        continue;
      }
      trace.push({ type: "final", text });
      return { answer: text || "(ריק)", trace };
    }

    lastTurnHadToolError = false;
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      const input = coerceNumericArgs(parseToolArguments(tc.function?.arguments));
      trace.push({ type: "tool_call", name, input });
      const result = await callMcpTool(args.mcp, name, input);
      trace.push({ type: "tool_result", name, outputText: result.text });
      if (isMcpToolErrorText(result.text)) lastTurnHadToolError = true;
      messages.push({
        role: "tool",
        name,
        content: result.text,
      });
    }
  }

  const fallback = "לא הצלחתי לסיים תשובה במסגרת מספר הסבבים המותר. נסה לשאול בצורה מצומצמת יותר.";
  trace.push({ type: "final", text: fallback });
  return { answer: fallback, trace };
};
