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
            "If a tool call returns JSON, use it as the source of truth.\n\n" +
            `Question: ${args.question}`,
        },
      ],
    },
  ];

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
      trace.push({ type: "final", text });
      return { answer: text, trace };
    }

    for (const tu of toolUses) {
      trace.push({ type: "tool_call", name: tu.name, input: tu.input });
      const result = await callMcpTool(args.mcp, tu.name, tu.input);
      trace.push({ type: "tool_result", name: tu.name, outputText: result.text });

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

