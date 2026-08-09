/**
 * Deterministic CSV / XLSX parser for the Recovery Factory.
 * Returns headers + row objects keyed by header.
 *
 * XLSX parsing uses `read-excel-file` (browser-native, no CVEs) instead of
 * the deprecated `xlsx` package (SheetJS CE 0.18.5, prototype-pollution CVE).
 */
import readXlsxFile from 'read-excel-file/browser';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

function parseCsv(text: string): ParsedFile {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field); field = '';
        if (cur.some(v => v.length > 0)) lines.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); if (cur.some(v => v.length > 0)) lines.push(cur); }
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows = lines.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'csv' || file.type === 'text/csv') {
    const text = await file.text();
    return parseCsv(text);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    // readXlsxFile returns an array of sheet objects; we use the first sheet.
    // Each sheet has a `data` property: (CellValue | null)[][]
    // where the first row contains the column headers.
    const sheets = await readXlsxFile(file);
    const data = sheets[0]?.data ?? [];
    if (data.length === 0) return { headers: [], rows: [] };
    const headers = data[0].map(cell => String(cell ?? '').trim());
    const rows = data.slice(1).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim(); });
      return obj;
    });
    return { headers, rows };
  }
  throw new Error(`Unsupported file type: .${ext}. Use CSV or XLSX.`);
}
