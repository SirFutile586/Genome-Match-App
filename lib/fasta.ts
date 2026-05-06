// Minimal FASTA parser. Kept here as the eventual home for parsing the
// CDS / 5'-UTR / transcript files that ship inside an NCBI gene data package.

export interface FastaRecord {
  id: string;
  description: string;
  sequence: string;
}

export function parseFasta(text: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  let current: FastaRecord | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('>')) {
      if (current) records.push(current);
      const header = line.slice(1).trim();
      const spaceIdx = header.indexOf(' ');
      current = {
        id: spaceIdx === -1 ? header : header.slice(0, spaceIdx),
        description: spaceIdx === -1 ? '' : header.slice(spaceIdx + 1),
        sequence: '',
      };
    } else if (current) {
      current.sequence += line.replace(/\s+/g, '').toUpperCase();
    }
  }
  if (current) records.push(current);
  return records;
}
