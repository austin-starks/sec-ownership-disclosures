/**
 * Parser for EDGAR's daily form index (`form.YYYYMMDD.idx`): a fixed preamble, a
 * dashed separator, then one line per filing. Form Type is a fixed 17-character
 * column (form types contain spaces, "1-A POS"); the rest of the line is read from
 * its right-hand columns inward (File Name, Date Filed, CIK), leaving the company
 * name, which can itself contain runs of spaces.
 */
export const INSIDER_FORM_TYPES: ReadonlySet<string> = new Set(["3", "3/A", "4", "4/A", "5", "5/A"]);

export interface EdgarIndexEntry {
  formType: string;
  companyName: string;
  cik: string;
  /** YYYY-MM-DD */
  dateFiled: string;
  fileName: string;
  accession: string;
}

const SEPARATOR = /^-{20,}\s*$/;
const FORM_TYPE_WIDTH = 17;
const REST = /^(\S.*?)\s{2,}(\d+)\s+(\d{4})(\d{2})(\d{2})\s+(\S+)\s*$/;

export function parseEdgarDailyFormIndex(text: string): EdgarIndexEntry[] {
  const lines = text.split(/\r?\n/);
  const separatorIndex = lines.findIndex((line) => SEPARATOR.test(line));
  if (separatorIndex < 0) throw new Error("EDGAR daily index has no header separator");
  return lines
    .slice(separatorIndex + 1)
    .filter((line) => line.trim().length > 0)
    .map((line): EdgarIndexEntry => {
      const formType = line.slice(0, FORM_TYPE_WIDTH).trim();
      const match = REST.exec(line.slice(FORM_TYPE_WIDTH));
      if (!formType || !match) throw new Error(`Unrecognized EDGAR daily index line: "${line.trim()}"`);
      const [, companyName, cik, year, month, day, fileName] = match;
      if (!companyName || !cik || !year || !month || !day || !fileName) {
        throw new Error(`Unrecognized EDGAR daily index line: "${line.trim()}"`);
      }
      const base = fileName.split("/").pop() ?? "";
      return {
        formType,
        companyName,
        cik,
        dateFiled: `${year}-${month}-${day}`,
        fileName,
        accession: base.replace(/\.txt$/, ""),
      };
    });
}

export function insiderIndexEntries(entries: readonly EdgarIndexEntry[]): EdgarIndexEntry[] {
  return entries.filter((entry) => INSIDER_FORM_TYPES.has(entry.formType));
}
