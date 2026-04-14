import "dotenv/config";
import path from "node:path";

import { runAnthropicAgent } from "./agent.js";
import { runOllamaAgent } from "./ollamaAgent.js";
import { connectMcpStdio, closeMcp, listMcpTools } from "./mcpClient.js";

const parseArgs = (argv: string[]) => {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }

  return { flags, positional };
};

const main = async () => {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  const question = positional.join(" ").trim();
  if (!question) {
    console.error(
      'Usage: npm run agent -- [--provider ollama|anthropic] [--trace] [--maxTurns N] -- "השאלה"\n\n' +
        "Default provider: ollama (no API key).\n\n" +
        "Ollama:\n" +
        "  OLLAMA_HOST (optional, default: http://127.0.0.1:11434)\n" +
        "  OLLAMA_MODEL (optional, default: llama3.1)\n\n" +
        "Anthropic:\n" +
        "  ANTHROPIC_API_KEY (required)\n" +
        "  ANTHROPIC_MODEL (optional)\n"
    );
    process.exit(1);
  }

  const showTrace = flags.has("trace");
  const providerRaw = flags.get("provider");
  const provider =
    typeof providerRaw === "string" && providerRaw.trim().length > 0
      ? providerRaw.trim().toLowerCase()
      : "ollama";
  if (provider !== "ollama" && provider !== "anthropic") {
    console.error(`Unknown --provider "${provider}". Use ollama or anthropic.`);
    process.exit(1);
  }
  const anthropicModel = (process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6").trim();
  const ollamaModel = (process.env.OLLAMA_MODEL ?? "llama3.1").trim();
  const maxTurns = Number.parseInt(String(flags.get("maxTurns") ?? "8"), 10);

  const mcpCwd = path.resolve(process.cwd());
  const conn = await connectMcpStdio({
    command: "node",
    args: ["dist/mcp/server.js"],
    cwd: mcpCwd,
    env: process.env as any,
  });

  try {
    const tools = await listMcpTools(conn);
    const opts = {
      maxTurns: Number.isFinite(maxTurns) ? maxTurns : 8,
      showTrace,
    };
    const result =
      provider === "anthropic"
        ? await runAnthropicAgent({
            question,
            mcp: conn,
            tools,
            options: { model: anthropicModel, ...opts },
          })
        : await runOllamaAgent({
            question,
            mcp: conn,
            tools,
            options: { model: ollamaModel, ...opts },
          });

    if (showTrace) {
      console.log("\n--- TRACE ---");
      for (const e of result.trace) {
        if (e.type === "tool_call") console.log(`tool_call: ${e.name} input=${JSON.stringify(e.input)}`);
        if (e.type === "tool_result") console.log(`tool_result: ${e.name} output=${e.outputText}`);
      }
      console.log("--- END TRACE ---\n");
    }

    console.log(result.answer);
  } finally {
    await closeMcp(conn);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

