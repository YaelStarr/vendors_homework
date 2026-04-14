export type TraceEvent =
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; outputText: string }
  | { type: "final"; text: string };

export type AgentOptions = {
  model: string;
  maxTurns: number;
  showTrace: boolean;
};

