import type { DbState, Severity, Status, Vendor, Vulnerability } from "./models.js";

export type Pagination = { limit?: number; offset?: number };

/**
 * Paginate an in-memory array.
 * Clamps `offset` to >= 0 and `limit` to [1..200] (default 50).
 */
export const paginate = <T>(items: T[], { limit, offset }: Pagination) => {
  const off = Math.max(0, offset ?? 0);
  const lim = Math.min(200, Math.max(1, limit ?? 50));
  const sliced = items.slice(off, off + lim);
  return { total: items.length, limit: lim, offset: off, items: sliced };
};

export const normalizeText = (v: string) => {
  return v.trim().toLowerCase();
};

/**
 * List vendors, optionally filtered by a substring match on vendor name.
 * Results are sorted by name and returned with pagination metadata.
 */
export const listVendors = (db: DbState, args: { query?: string } & Pagination) => {
  const q = args.query ? normalizeText(args.query) : "";
  const items = q
    ? db.vendors.filter((v) => normalizeText(v.name).includes(q))
    : [...db.vendors];
  items.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(items, args);
};

/**
 * Get a vendor by id and include vulnerability statistics for that vendor.
 */
export const getVendor = (
  db: DbState,
  vendor_id: string
): (Vendor & { stats: VendorStats }) | null => {
  const vendor = db.vendorById.get(vendor_id);
  if (!vendor) return null;
  const vulns = db.vulnsByVendorId.get(vendor_id) ?? [];
  const stats = vendorStatsFromVulns(vulns);
  return { ...vendor, stats };
};

export type VendorStats = {
  total: number;
  open: number;
  patched: number;
  bySeverity: Record<Severity, number>;
  avgCvss: number | null;
  maxCvss: number | null;
};

const vendorStatsFromVulns = (vulns: Vulnerability[]): VendorStats => {
  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let open = 0;
  let patched = 0;
  let sum = 0;
  let count = 0;
  let max: number | null = null;

  for (const v of vulns) {
    bySeverity[v.severity] += 1;
    if (v.status === "open") open += 1;
    if (v.status === "patched") patched += 1;
    if (v.cvss_score != null) {
      sum += v.cvss_score;
      count += 1;
      max = max == null ? v.cvss_score : Math.max(max, v.cvss_score);
    }
  }

  return {
    total: vulns.length,
    open,
    patched,
    bySeverity,
    avgCvss: count ? sum / count : null,
    maxCvss: max,
  };
};

/**
 * Get a vulnerability by CVE id (or null if not found).
 */
export const getVulnerability = (db: DbState, cve_id: string) => {
  return db.vulnByCve.get(cve_id) ?? null;
};

export type SearchVulnsArgs = Pagination & {
  text?: string;
  vendor_id?: string;
  vendor_name?: string;
  severity?: Severity;
  status?: Status;
  min_cvss?: number;
  max_cvss?: number;
  from_published?: string;
  to_published?: string;
};

/**
 * Search vulnerabilities with optional filters (text, vendor, severity/status, CVSS range, date range),
 * sorted by published date (newest first) and returned with pagination metadata.
 */
export const searchVulnerabilities = (db: DbState, args: SearchVulnsArgs) => {
  const q = args.text ? normalizeText(args.text) : "";
  const vendorNameQ = args.vendor_name ? normalizeText(args.vendor_name) : "";
  const fromTs = args.from_published ? Date.parse(args.from_published) : Number.NaN;
  const toTs = args.to_published ? Date.parse(args.to_published) : Number.NaN;

  let candidates: Vulnerability[];
  if (args.vendor_id) candidates = db.vulnsByVendorId.get(args.vendor_id) ?? [];
  else candidates = db.vulnerabilities;

  const items = candidates.filter((v) => {
    if (args.severity && v.severity !== args.severity) return false;
    if (args.status && v.status !== args.status) return false;
    if (args.min_cvss != null && (v.cvss_score == null || v.cvss_score < args.min_cvss)) return false;
    if (args.max_cvss != null && (v.cvss_score == null || v.cvss_score > args.max_cvss)) return false;

    if (vendorNameQ) {
      const vendor = db.vendorById.get(v.vendor_id);
      if (!vendor || !normalizeText(vendor.name).includes(vendorNameQ)) return false;
    }

    if (q) {
      const hay = `${v.cve_id} ${v.id} ${v.title}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (Number.isFinite(fromTs)) {
      if (v.published_ts == null || v.published_ts < fromTs) return false;
    }
    if (Number.isFinite(toTs)) {
      if (v.published_ts == null || v.published_ts > toTs) return false;
    }

    return true;
  });

  items.sort((a, b) => (b.published_ts ?? 0) - (a.published_ts ?? 0));
  return paginate(items, args);
};

/**
 * Compute aggregate vulnerability statistics (optionally filtered by vendor and date range),
 * plus the top vendors by number of open vulnerabilities.
 */
export const vulnerabilityStats = (
  db: DbState,
  args: { vendor_id?: string; from_published?: string; to_published?: string } = {}
): {
  total: number;
  bySeverity: Record<Severity, number>;
  byStatus: Record<Status, number>;
  topOpenVendors: Array<{ vendor_id: string; vendor_name: string; open: number }>;
} => {
  const result = searchVulnerabilities(db, {
    vendor_id: args.vendor_id,
    from_published: args.from_published,
    to_published: args.to_published,
    limit: 200,
    offset: 0,
  });

  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus: Record<Status, number> = { open: 0, patched: 0 };

  for (const v of result.items) {
    bySeverity[v.severity] += 1;
    byStatus[v.status] += 1;
  }

  const topOpenVendors = [...db.vulnsByVendorId.entries()]
    .map(([vendorId, vulns]) => {
      const open = vulns.filter((v) => v.status === "open").length;
      return { vendor_id: vendorId, vendor_name: db.vendorById.get(vendorId)?.name ?? vendorId, open };
    })
    .filter((x) => x.open > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 10);

  return {
    total: result.total,
    bySeverity,
    byStatus,
    topOpenVendors,
  };
};

