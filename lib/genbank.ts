// GenBank feature-table parser. Used (in the production NCBI pipeline) to
// pull CDS and 5'-UTR coordinates from a transcript record so the app can
// compute the transcript 5' end and define the 0 bp anchor.
//
// In the demo pipeline this module is unused; it is included so the file
// tree matches the production design and so swapping in real NCBI fetches
// requires zero refactoring.

export interface GenbankFeature {
  type: string;        // e.g. "CDS", "5'UTR", "exon"
  start: number;       // 1-based, inclusive (GenBank convention)
  end: number;         // 1-based, inclusive
  complement: boolean; // true if the feature is on the complementary strand
}

export interface TranscriptBoundaries {
  cdsStart: number | null;   // 1-based
  cdsEnd: number | null;     // 1-based
  fivePrimeUtrEnd: number | null;
  zeroPoint: number;         // transcript 5' end (always 1 here)
}

const LOCATION_RE = /(complement\()?(\d+)\.\.(\d+)\)?/;

export function parseGenbankFeatures(text: string): GenbankFeature[] {
  const features: GenbankFeature[] = [];
  const lines = text.split(/\r?\n/);
  let inFeatures = false;
  for (const line of lines) {
    if (line.startsWith('FEATURES')) {
      inFeatures = true;
      continue;
    }
    if (inFeatures && line.startsWith('ORIGIN')) break;
    if (!inFeatures) continue;
    if (!line.startsWith('     ')) continue;
    const trimmed = line.trim();
    // Feature header lines look like: `CDS             complement(1..100)`
    const headerMatch = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!headerMatch) continue;
    const [, type, locRaw] = headerMatch;
    if (!/^[A-Z0-9_'-]+$/i.test(type)) continue;
    const locMatch = locRaw.match(LOCATION_RE);
    if (!locMatch) continue;
    features.push({
      type,
      complement: !!locMatch[1],
      start: parseInt(locMatch[2], 10),
      end: parseInt(locMatch[3], 10),
    });
  }
  return features;
}

export function findTranscriptBoundaries(
  features: GenbankFeature[]
): TranscriptBoundaries {
  const cds = features.find((f) => f.type === 'CDS') ?? null;
  const utr = features.find((f) => f.type === "5'UTR" || f.type === 'five_prime_UTR') ?? null;
  return {
    cdsStart: cds ? cds.start : null,
    cdsEnd: cds ? cds.end : null,
    fivePrimeUtrEnd: utr ? utr.end : null,
    zeroPoint: 1, // transcript 5' end on the transcript itself
  };
}
