// NCBI Gene Datasets integration seam.
//
// The production version of this module should:
//   1. Resolve a gene symbol -> NCBI Gene ID for the requested organism.
//      e.g. https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/{symbol}/taxon/{taxon}
//   2. Download the gene data package ZIP (CDS + 5'-UTR + transcript FASTA).
//      e.g. https://api.ncbi.nlm.nih.gov/datasets/v2/gene/id/{geneId}/download
//   3. Decompress the ZIP (ncbi_dataset/data/...) and read FASTA + GenBank.
//   4. Pick a representative transcript (MANE Select if available, else longest).
//   5. Compute the transcript 5' end on the genomic contig and slice the
//      0..10,000 bp upstream window.
//
// In this scaffold we implement a *deterministic demo sequence generator* so
// the app builds and runs on Vercel out of the box without network access or
// an NCBI API key. The generator is keyed by (gene symbol, species) so the
// same query always produces the same window — useful for debugging the
// motif engine and the UI.
//
// TODO(NCBI): replace `downloadSequence` with a real fetch + ZIP decompress
// pipeline (e.g. `unzipper` or `fflate`) and a transcript picker. See
// https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/ for endpoints.

export type Species = 'human' | 'mouse';

export interface SequencePackage {
  species: Species;
  taxon: string;            // human-readable taxon
  geneSymbol: string;
  // The 0..10,000 bp upstream window (5' -> 3' on the transcript strand).
  // Position 0 corresponds to the transcript 5' end in this scaffold.
  promoterWindow: string;
  windowStart: number;      // always 0 in this scaffold
  windowEnd: number;        // length of `promoterWindow`
  zeroPoint: number;        // transcript 5' end (always 0 in this scaffold)
  source: 'demo' | 'ncbi';
  notes: string[];
}

export const SPECIES_TAXON: Record<Species, string> = {
  human: 'Homo sapiens',
  mouse: 'Mus musculus (house mouse)',
};

const WINDOW_LENGTH = 10_000;

/**
 * Public entry point. Today this returns a deterministic demo sequence.
 * Swap the implementation here once the real NCBI pipeline is wired in.
 */
export async function downloadSequence(
  geneSymbol: string,
  species: Species
): Promise<SequencePackage> {
  const symbol = (geneSymbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('Gene symbol is required.');

  const promoterWindow = generateDemoSequence(symbol, species, WINDOW_LENGTH);

  return {
    species,
    taxon: SPECIES_TAXON[species],
    geneSymbol: symbol,
    promoterWindow,
    windowStart: 0,
    windowEnd: promoterWindow.length,
    zeroPoint: 0,
    source: 'demo',
    notes: [
      'Demo sequence generated deterministically from (gene, species).',
      'Replace lib/ncbi.ts::downloadSequence with a real NCBI Datasets fetch for production.',
    ],
  };
}

/**
 * Mulberry32 PRNG seeded from a string. Good enough for reproducible demo data.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BASES = ['A', 'C', 'G', 'T'] as const;

/**
 * Build a deterministic 10 kb sequence and seed it with a few well-known
 * motifs (TATA box, CAAT box, the user-friendly TTCnnnGAA GAS-like motif)
 * so a fresh user can run a search and immediately see hits.
 */
export function generateDemoSequence(
  geneSymbol: string,
  species: Species,
  length: number
): string {
  const rng = mulberry32(hashSeed(`${geneSymbol}|${species}`));
  const buf = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    buf[i] = BASES[Math.floor(rng() * 4)];
  }

  // Plant a few canonical promoter elements at deterministic positions.
  const plant = (motif: string, pos: number) => {
    if (pos < 0 || pos + motif.length > length) return;
    for (let i = 0; i < motif.length; i++) buf[pos + i] = motif[i];
  };

  plant('TATAAA', Math.floor(rng() * (length - 6)));
  plant('CAATCT', Math.floor(rng() * (length - 6)));
  // Two GAS-like sites (TTCnnnGAA family) so demo searches succeed.
  const fillN = (template: string) =>
    template.replace(/n/g, () => BASES[Math.floor(rng() * 4)]);
  plant(fillN('TTCnnnGAA'), Math.floor(rng() * (length - 9)));
  plant(fillN('TTCnnnGAA'), Math.floor(rng() * (length - 9)));

  return buf.join('');
}
