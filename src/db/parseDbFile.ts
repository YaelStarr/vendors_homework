import * as fs from "node:fs/promises";

export type ParsedDbFile = {
  version: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
};

export class DbParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbParseError";
  }
}

const parseMetadata = (lines: string[]) => {
  const warnings: string[] = [];

  let version: string | undefined;
  let formatLine: string | undefined;

  for (const line of lines) {
    if (!line.trim().startsWith("#")) break;

    const mVersion = line.match(/^#\s*VERSION:\s*(.+)\s*$/);
    if (mVersion) {
      version = mVersion[1].trim();
      continue;
    }

    const mFormat = line.match(/^#\s*FORMAT:\s*(.+)\s*$/);
    if (mFormat) {
      formatLine = mFormat[1].trim();
      continue;
    }
  }

  if (!version) throw new DbParseError("Missing metadata field: VERSION");
  if (!formatLine) throw new DbParseError("Missing metadata field: FORMAT");

  const columns = formatLine
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (columns.length === 0) throw new DbParseError("FORMAT has zero columns");

  // Best-effort sanity checks; keep as warnings to stay forward-compatible.
  const duplicates = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (duplicates.length > 0) {
    warnings.push(`FORMAT contains duplicate columns: ${[...new Set(duplicates)].join(", ")}`);
  }

  return { version, columns, warnings };
};

export const parseDbFile = async (filePath: string): Promise<ParsedDbFile> => {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);

  const { version, columns, warnings: metadataWarnings } = parseMetadata(lines);

  const warnings: string[] = [...metadataWarnings];
  const rows: Array<Record<string, string>> = [];

  let rowIndex = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;

    rowIndex += 1;
    const parts = line.split("|");

    if (parts.length !== columns.length) {
      warnings.push(
        `Row ${rowIndex}: expected ${columns.length} fields but got ${parts.length} (line skipped)`
      );
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = parts[i] ?? "";
    rows.push(row);
  }

  return { version, columns, rows, warnings };
};

