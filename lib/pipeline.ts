import { downloadSequence, Species, SPECIES_TAXON } from './ncbi';
import { findMotifMatches, MotifMatch } from './sequence';
import { validateMotif } from './iupac';

export interface SpeciesResult {
  species: Species;
  taxon: string;
  geneSymbol: string;
  promoterWindow: string;
  windowStart: number;
  windowEnd: number;
  zeroPoint: number;
  source: 'demo' | 'ncbi';
  matches: MotifMatch[];
  notes: string[];
}

export interface SearchRequest {
  gene: string;
  motif: string;
  flankBefore?: number;
  flankAfter?: number;
  species?: Species[];
}

export interface SearchResponse {
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  results: SpeciesResult[];
  warnings: string[];
}

const DEFAULT_SPECIES: Species[] = ['human', 'mouse'];

export async function runSearch(req: SearchRequest): Promise<SearchResponse> {
  const gene = (req.gene || '').trim().toUpperCase();
  if (!gene) throw new Error('Gene symbol is required.');
  const motif = validateMotif(req.motif || '');

  const flankBefore = clamp(req.flankBefore, 0, 500, 50);
  const flankAfter = clamp(req.flankAfter, 0, 500, 50);

  const species = req.species && req.species.length ? req.species : DEFAULT_SPECIES;
  const warnings: string[] = [];
  const results: SpeciesResult[] = [];

  for (const sp of species) {
    try {
      const pkg = await downloadSequence(gene, sp);
      const matches = findMotifMatches(pkg.promoterWindow, motif, {
        flankBefore,
        flankAfter,
      });
      results.push({
        species: sp,
        taxon: pkg.taxon,
        geneSymbol: pkg.geneSymbol,
        promoterWindow: pkg.promoterWindow,
        windowStart: pkg.windowStart,
        windowEnd: pkg.windowEnd,
        zeroPoint: pkg.zeroPoint,
        source: pkg.source,
        matches,
        notes: pkg.notes,
      });
    } catch (e) {
      warnings.push(
        `Failed to load ${SPECIES_TAXON[sp]} sequence for ${gene}: ${(e as Error).message}`
      );
    }
  }

  return { gene, motif, flankBefore, flankAfter, results, warnings };
}

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
