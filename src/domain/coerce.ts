import { severityValues, statusValues, type Severity, type Status, type Vendor, type Vulnerability } from "./models.js";

const isOneOf = <T extends readonly string[]>(values: T, v: string): v is T[number] => {
  return (values as readonly string[]).includes(v);
};

export const toIntOrNull = (v: string): number | null => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export const toFloatOrNull = (v: string): number | null => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const toIsoDateTsOrNull = (v: string): number | null => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

export const coerceVendor = (row: Record<string, string>): Vendor => {
  return {
    id: row["id"] ?? "",
    name: row["name"] ?? "",
    category: row["category"] ?? "",
    hq: row["hq"] ?? "",
    founded: row["founded"] ? toIntOrNull(row["founded"]) : null,
    raw: row,
  };
};

export const coerceSeverity = (v: string): Severity => {
  const lowered = v.toLowerCase();
  if (isOneOf(severityValues, lowered)) return lowered;
  return "low";
};

export const coerceStatus = (v: string): Status => {
  const lowered = v.toLowerCase();
  if (isOneOf(statusValues, lowered)) return lowered;
  return "open";
};

export const coerceVulnerability = (row: Record<string, string>): Vulnerability => {
  const cvssRaw = row["cvss_score"] ?? "";
  const published = row["published"] ?? "";

  return {
    id: row["id"] ?? "",
    cve_id: row["cve_id"] ?? "",
    title: row["title"] ?? "",
    vendor_id: row["vendor_id"] ?? "",
    severity: coerceSeverity(row["severity"] ?? ""),
    cvss_score: cvssRaw ? toFloatOrNull(cvssRaw) : null,
    affected_versions: row["affected_versions"] ?? "",
    status: coerceStatus(row["status"] ?? ""),
    published,
    published_ts: published ? toIsoDateTsOrNull(published) : null,
    raw: row,
  };
};

