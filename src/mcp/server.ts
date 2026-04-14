import "dotenv/config";
import path from "node:path";
import * as z from "zod/v4";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseDbFile } from "../db/parseDbFile.js";
import { coerceVendor, coerceVulnerability } from "../domain/coerce.js";
import { buildDbState } from "../domain/indexes.js";
import { getVendor, getVulnerability, listVendors, searchVulnerabilities, vulnerabilityStats } from "../domain/query.js";
import { severityValues, statusValues } from "../domain/models.js";

const resolveDbPath = (envKey: string, defaultRelativePath: string) => {
  const env = process.env[envKey];
  if (env && env.trim().length > 0) return path.resolve(process.cwd(), env);
  return path.resolve(process.cwd(), defaultRelativePath);
};

const loadDb = async () => {
  const vendorsPath = resolveDbPath("VENDORS_DB_PATH", "data/vendors.db");
  const vulnsPath = resolveDbPath("VULNERABILITIES_DB_PATH", "data/vulnerabilities.db");

  const vendorsFile = await parseDbFile(vendorsPath);
  const vulnsFile = await parseDbFile(vulnsPath);

  const vendors = vendorsFile.rows
    .filter((r) => (r["type"] ?? "").toUpperCase() === "VENDOR")
    .map(coerceVendor);

  const vulnerabilities = vulnsFile.rows
    .filter((r) => (r["type"] ?? "").toUpperCase() === "VULN")
    .map(coerceVulnerability);

  const db = buildDbState({ vendors, vulnerabilities });

  return {
    db,
    meta: {
      vendors: { ...vendorsFile, rows: undefined },
      vulnerabilities: { ...vulnsFile, rows: undefined },
      paths: { vendorsPath, vulnsPath },
    },
  };
};

const jsonText = (value: unknown) => {
  return JSON.stringify(value, null, 2);
};

const main = async () => {
  const { db, meta } = await loadDb();

  const server = new McpServer({
    name: "vendors-vulns-db",
    version: "1.0.0",
  });

  server.registerTool(
    "list_vendors",
    {
      title: "List vendors",
      description: "List vendors, optionally filtered by name query (substring match).",
      inputSchema: {
        query: z.string().optional().describe("Substring filter on vendor name"),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
        offset: z.number().int().min(0).optional().describe("Offset (default 0)"),
      },
    },
    async (args) => {
      const res = listVendors(db, args);
      return { content: [{ type: "text", text: jsonText(res) }] };
    }
  );

  server.registerTool(
    "get_vendor",
    {
      title: "Get vendor",
      description: "Get a vendor by id, including vulnerability statistics for that vendor.",
      inputSchema: {
        vendor_id: z.string().min(1).describe("Vendor id (e.g. V1)"),
      },
    },
    async ({ vendor_id }) => {
      const vendor = getVendor(db, vendor_id);
      if (!vendor) return { content: [{ type: "text", text: jsonText({ error: "Vendor not found", vendor_id }) }] };
      return { content: [{ type: "text", text: jsonText(vendor) }] };
    }
  );

  server.registerTool(
    "get_vulnerability",
    {
      title: "Get vulnerability",
      description: "Get a vulnerability by CVE id, enriched with vendor info.",
      inputSchema: {
        cve_id: z.string().min(1).describe("CVE id (e.g. CVE-2021-44228)"),
      },
    },
    async ({ cve_id }) => {
      const vuln = getVulnerability(db, cve_id);
      if (!vuln) return { content: [{ type: "text", text: jsonText({ error: "Vulnerability not found", cve_id }) }] };
      const vendor = db.vendorById.get(vuln.vendor_id) ?? null;
      return { content: [{ type: "text", text: jsonText({ ...vuln, vendor }) }] };
    }
  );

  server.registerTool(
    "get_current_date",
    {
      title: "Get current date/time",
      description:
        "Return the current local date/time of the machine running the MCP server. Use this to resolve relative time phrases like 'last year' or 'in the past 30 days'.",
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      return {
        content: [
          {
            type: "text",
            text: jsonText({
              now_iso: now.toISOString(),
              today: now.toISOString().slice(0, 10),
              now_ts: now.getTime(),
              timezone_offset_minutes: now.getTimezoneOffset(),
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "search_vulnerabilities",
    {
      title: "Search vulnerabilities",
      description:
        "Search vulnerabilities with filters. Supports text search over cve_id/id/title, vendor filters, severity/status, CVSS range and published date range.",
      inputSchema: {
        text: z.string().optional().describe("Substring match over cve_id, id, title"),
        vendor_id: z.string().optional().describe("Filter by vendor id (e.g. V2)"),
        vendor_name: z.string().optional().describe("Filter by vendor name substring"),
        severity: z.enum(severityValues).optional().describe("Severity filter"),
        status: z.enum(statusValues).optional().describe("Status filter"),
        min_cvss: z.number().min(0).max(10).optional().describe("Minimum CVSS score"),
        max_cvss: z.number().min(0).max(10).optional().describe("Maximum CVSS score"),
        from_published: z.string().optional().describe("ISO date lower bound (YYYY-MM-DD)"),
        to_published: z.string().optional().describe("ISO date upper bound (YYYY-MM-DD)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
        offset: z.number().int().min(0).optional().describe("Offset (default 0)"),
      },
    },
    async (args) => {
      const res = searchVulnerabilities(db, args);
      const enriched = {
        ...res,
        items: res.items.map((v) => ({
          ...v,
          vendor_name: db.vendorById.get(v.vendor_id)?.name ?? v.vendor_id,
        })),
      };
      return { content: [{ type: "text", text: jsonText(enriched) }] };
    }
  );

  server.registerTool(
    "vulnerability_stats",
    {
      title: "Vulnerability statistics",
      description: "Aggregate stats over vulnerabilities with optional vendor and date range filters.",
      inputSchema: {
        vendor_id: z.string().optional().describe("Filter by vendor id (e.g. V5)"),
        from_published: z.string().optional().describe("ISO date lower bound (YYYY-MM-DD)"),
        to_published: z.string().optional().describe("ISO date upper bound (YYYY-MM-DD)"),
      },
    },
    async (args) => {
      const res = vulnerabilityStats(db, args);
      return { content: [{ type: "text", text: jsonText({ ...res, meta }) }] };
    }
  );

  await server.connect(new StdioServerTransport());
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

