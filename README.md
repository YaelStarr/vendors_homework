## Vendors & Vulnerabilities — MCP Server (TypeScript)

A small TypeScript project that wraps two legacy, pipe-delimited text databases:

- `vendors.db` (software vendors)
- `vulnerabilities.db` (CVEs / vulnerabilities, each linked to a vendor)

It exposes a **Model Context Protocol (MCP) server** with practical tools for searching, filtering, and aggregating the data — so an MCP-compatible client (e.g., Claude Desktop) or an agent can query it reliably.

---

## What this project provides

### MCP Server

- Loads both DB files on startup
- Dynamically parses metadata (`# VERSION`, `# FORMAT`)
- Stores records in memory and builds indexes for fast lookups
- Exposes MCP **tools** over stdio

### Optional Agent CLI

A CLI “agent” that:

- Spawns the local MCP server (`node dist/mcp/server.js`)
- Lists available MCP tools
- Lets an LLM call tools iteratively and produces a final answer

Providers:

- **Ollama** (local, no API key) — requires a model that supports tool calling
- **Anthropic** (optional) — requires `ANTHROPIC_API_KEY`

---

## Requirements

- Node.js 18+ recommended
- npm

Optional:

- Ollama (for local agent runs)
- Claude Desktop (for GUI MCP testing)

---

## Install

```bash
npm install
```

---

## Build

```bash
npm run build
```

---

## Run the MCP server

### Production (compiled JS)

```bash
npm start
```

### Dev (run TypeScript directly)

```bash
npm run dev
```

Note: This server communicates via **stdio** (not HTTP). It will appear to “hang” because it’s waiting for an MCP client to connect.

---

## Data files

By default, the server reads:

- `data/vendors.db`
- `data/vulnerabilities.db`

You can override paths via environment variables:

- `VENDORS_DB_PATH`
- `VULNERABILITIES_DB_PATH`

Example (Windows PowerShell):

```powershell
$env:VENDORS_DB_PATH=".\data\vendors.db"
$env:VULNERABILITIES_DB_PATH=".\data\vulnerabilities.db"
npm run dev
```

---

## MCP Tools

### `list_vendors`

List vendors with pagination and optional name substring filter.

Input:

- `query?`: string — substring filter on vendor name
- `limit?`: number (1..200)
- `offset?`: number (>=0)

---

### `get_vendor`

Get a vendor by `vendor_id`, including vulnerability statistics for that vendor.

Input:

- `vendor_id`: string (e.g., `V1`)

Output includes:

- Vendor fields
- `stats`: totals by status/severity, avg/max CVSS

---

### `search_vulnerabilities`

Search vulnerabilities with analytic filters.

Input:

- `text?`: substring match over `cve_id`, `id`, `title`
- `vendor_id?`: filter by vendor id (e.g., `V2`)
- `vendor_name?`: filter by vendor name substring
- `severity?`: `low|medium|high|critical`
- `status?`: `open|patched`
- `min_cvss?`: number (0..10)
- `max_cvss?`: number (0..10)
- `from_published?`: ISO date `YYYY-MM-DD`
- `to_published?`: ISO date `YYYY-MM-DD`
- `limit?`, `offset?`

Output:

- `total`, `limit`, `offset`
- `items[]` (enriched with `vendor_name`)

---

### `get_vulnerability`

Get a vulnerability by `cve_id`, enriched with vendor info.

Input:

- `cve_id`: string (e.g., `CVE-2021-44228`)

---

### `get_current_date`

Return the current local date/time of the machine running the MCP server. Useful for resolving relative time phrases like “last year”, “past 30 days”, or `בשנה האחרונה` into explicit `from_published` / `to_published` bounds.

Input: none

Output:

- `now_iso`: ISO timestamp
- `today`: `YYYY-MM-DD`
- `now_ts`: unix milliseconds
- `timezone_offset_minutes`

---

### `vulnerability_stats`

Aggregate statistics across vulnerabilities (optionally filtered by vendor and date range).

Input:

- `vendor_id?`
- `from_published?`
- `to_published?`

Output:

- counts by severity & status
- `topOpenVendors`
- includes basic DB metadata (paths, versions, warnings)

---

## Agent CLI (optional)

### Build + run (Ollama)

```bash
npm run build
npm run agent -- "What is the CVSS of Log4Shell?" --trace
```

To select a model:

- `OLLAMA_MODEL` (default in code: `llama3.1`)
- `OLLAMA_HOST` (default: `http://127.0.0.1:11434`)

Example (PowerShell):

```powershell
$env:OLLAMA_MODEL="llama3.1"
npm run agent -- "How many critical vulnerabilities are still open?" --trace
```

Tip: For questions like “in the past year / בשנה האחרונה”, the agent will first call `get_current_date` and then translate the request into explicit date bounds for `from_published` / `to_published`.

### Anthropic provider (optional)

You can configure Anthropic via environment variables or a local `.env` file (loaded automatically by the Agent CLI).

Recommended `.env` (project root):

```dotenv
ANTHROPIC_API_KEY=YOUR_KEY
# Optional: override the model if needed.
# If you get a 404 "model: ...", it means that model isn't available to your key/account.
ANTHROPIC_MODEL=claude-opus-4-6
```

Or set env vars in PowerShell:

```powershell
$env:ANTHROPIC_API_KEY="YOUR_KEY"
$env:ANTHROPIC_MODEL="claude-opus-4-6"
npm run build
npm run agent -- --provider anthropic "How many critical vulnerabilities are still open?"
```

---

## Claude Desktop (GUI MCP)

Add this to your `claude_desktop_config.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "vendors-vulns-db": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": {}
    }
  }
}
```

Then:

```bash
npm run build
```

Restart Claude Desktop, and ask questions like:

- “How many critical vulnerabilities are still open?”
- “What is the CVSS score of CVE-2021-44228?”

---

## Design notes (brief)

- **Dynamic metadata parsing**: the parser reads `# VERSION` and `# FORMAT` so it stays resilient if columns change.
- **In-memory + indexes**: `Map`s (`vendorById`, `vulnByCve`, `vulnsByVendorId`) enable fast lookups and vendor-level aggregations.
- **Input validation**: tool input schemas are defined with Zod for safer tool calls.
- **Pagination**: list/search tools support `limit`/`offset` and return consistent metadata.

---

## Known limitations / trade-offs

- Substring search is “best effort” (not a full-text index).
- For very large datasets, a dedicated search index would be faster than scanning arrays.
- Ollama requires a model that supports tool calling. Some models may not support tools.

---
## Design decisions (in plain words)

- **Why MCP and why stdio (not HTTP)**: I wanted this project to plug into MCP clients/agents easily, so I kept it as an MCP server over stdio. It’s simpler to run locally, has less “server setup” overhead, and fits the tool-calling flow well.

- **Loading the DB files into memory**: The DBs here are flat text files. I load them once on startup and keep the data in memory so every tool call is fast and consistent, without re-reading files on every request.

- **Indexes for fast lookups**: On top of the in-memory arrays, I build a few simple `Map` indexes (vendor by id, vulnerability by CVE, vulnerabilities by vendor). That way, common queries (get vendor, get CVE, vendor stats) don’t require scanning the entire dataset.

- **Parsing based on the file metadata**: The files include `# VERSION` and `# FORMAT`. I parse that metadata so the code is more resilient if the column order changes or new columns are added, instead of hardcoding “column 3 is X”.

- **Input validation because an LLM calls tools**: Since tools can be called by an LLM, inputs can be messy (wrong enum, negative offset, invalid dates). I validate inputs up front (with Zod) so failures are clear and predictable instead of producing weird partial results.

- **Pagination everywhere**: I used `limit/offset` consistently so responses stay bounded and clients can page through results safely.

- **Keeping layers separate**: I tried to keep parsing, query/index logic, and the MCP server layer separate so it’s easier to change one part later (e.g., replace the flat files with a real DB) without rewriting everything.

---

## If I had more time

- **Faster, smarter search (full-text search)**: Right now the search is basically a simple substring match (like `includes`) over text fields. It works, but it’s not “smart” search and it won’t scale as well when the dataset grows. With more time, I would add a proper full‑text search index (or integrate a dedicated search engine) to improve both relevance and performance on larger data.

- **Auto-reload when DB files change**: The server currently loads `vendors.db` and `vulnerabilities.db` on startup and keeps everything in memory. If the files change, you need to restart the server to see the updates. I’d add file watching (or an incremental reload mechanism) so changes to the DB files refresh the in-memory state and indexes without a restart.

- **Unit tests for parsing + query logic**: There’s a lot of parsing logic for the legacy text format and filtering/aggregation logic for queries. I’d add unit tests that cover edge cases (invalid lines, missing fields, date ranges, pagination, stats calculations) to increase confidence and prevent regressions when refactoring.

- **Benchmarking + observability**: To understand performance bottlenecks and debug issues faster, I’d add a small benchmark suite (load time, search time, aggregation time) and basic observability (structured logs/metrics like tool name, duration, result counts, error rates). That would make performance improvements measurable and troubleshooting much easier.

---

## License

ISC
