export const severityValues = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof severityValues)[number];

export const statusValues = ["open", "patched"] as const;
export type Status = (typeof statusValues)[number];

export type Vendor = {
  id: string;
  name: string;
  category: string;
  hq: string;
  founded: number | null;
  raw: Record<string, string>;
};

export type Vulnerability = {
  id: string;
  cve_id: string;
  title: string;
  vendor_id: string;
  severity: Severity;
  cvss_score: number | null;
  affected_versions: string;
  status: Status;
  published: string;
  published_ts: number | null;
  raw: Record<string, string>;
};

export type DbState = {
  vendors: Vendor[];
  vulnerabilities: Vulnerability[];
  vendorById: Map<string, Vendor>;
  vulnByCve: Map<string, Vulnerability>;
  vulnsByVendorId: Map<string, Vulnerability[]>;
};

