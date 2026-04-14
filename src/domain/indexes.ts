import type { DbState, Vendor, Vulnerability } from "./models.js";

export const buildDbState = (input: { vendors: Vendor[]; vulnerabilities: Vulnerability[] }): DbState => {
  const vendorById = new Map<string, Vendor>();
  for (const v of input.vendors) vendorById.set(v.id, v);

  const vulnByCve = new Map<string, Vulnerability>();
  const vulnsByVendorId = new Map<string, Vulnerability[]>();

  for (const vuln of input.vulnerabilities) {
    if (vuln.cve_id) vulnByCve.set(vuln.cve_id, vuln);

    const list = vulnsByVendorId.get(vuln.vendor_id);
    if (list) list.push(vuln);
    else vulnsByVendorId.set(vuln.vendor_id, [vuln]);
  }

  return {
    vendors: input.vendors,
    vulnerabilities: input.vulnerabilities,
    vendorById,
    vulnByCve,
    vulnsByVendorId,
  };
};

