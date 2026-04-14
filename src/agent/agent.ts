import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { McpConnection, McpTool } from "./mcpClient.js";
import { callMcpTool } from "./mcpClient.js";
import type { AgentOptions, TraceEvent } from "./types.js";

const toAnthropicTools = (tools: McpTool[]): Tool[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Tool.InputSchema,
  }));

const ensureApiKey = () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Set it in your environment before running the agent."
    );
  }
  return key;
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

export const runAnthropicAgent = async (args: {
  question: string;
  mcp: McpConnection;
  tools: McpTool[];
  options: AgentOptions;
}) => {
  const apiKey = ensureApiKey();
  const anthropic = new Anthropic({ apiKey });
  const trace: TraceEvent[] = [];

  const model = args.options.model;
  const maxTurns = args.options.maxTurns;
  const tools = toAnthropicTools(args.tools);

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "You are a security analyst assistant. Answer in Hebrew.\n" +
            "Use the provided tools when needed to look up vendors/vulnerabilities.\n" +
            "If a tool call returns JSON, use it as the source of truth.\n" +
            "If the user asks relative time ranges (e.g. 'last year', 'past 30 days', 'בשנה האחרונה'), call get_current_date first and derive explicit YYYY-MM-DD bounds.\n\n" +
            `Question: ${args.question}`,
        },
      ],
    },
  ];

  let lastTurnHadToolError = false;
  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 800,
      tools,
      messages,
    });

    // Append assistant content to conversation.
    messages.push({ role: "assistant", content: resp.content as any });

    // Find tool calls.
    const toolUses = resp.content.filter((c) => c.type === "tool_use") as Array<{
      id: string;
      name: string;
      input: unknown;
    }>;

    if (toolUses.length === 0) {
      const text = resp.content
        .filter((c) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();
      if (lastTurnHadToolError) {
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Your previous tool call failed (validation or execution error). " +
                "You MUST call the relevant tool again with corrected arguments (e.g. limit must be >= 1). " +
                "Do not guess or answer from memory until you have a successful tool result.",
            },
          ],
        });
        lastTurnHadToolError = false;
        continue;
      }
      trace.push({ type: "final", text });
      return { answer: text, trace };
    }

    lastTurnHadToolError = false;
    for (const tu of toolUses) {
      const input = coerceNumericArgs(tu.input);
      trace.push({ type: "tool_call", name: tu.name, input });
      const result = await callMcpTool(args.mcp, tu.name, input);
      trace.push({ type: "tool_result", name: tu.name, outputText: result.text });
      if (isMcpToolErrorText(result.text)) lastTurnHadToolError = true;

      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: tu.id,
            content: result.text,
          },
        ],
      });
    }
  }

  const fallback = "לא הצלחתי לסיים תשובה במסגרת מספר הסבבים המותר. נסי לשאול בצורה מצומצמת יותר.";
  trace.push({ type: "final", text: fallback });
  return { answer: fallback, trace };
};

