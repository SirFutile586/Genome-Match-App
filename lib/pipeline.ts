import { downloadSequence, Species, SPECIES_TAXON, SequencePackage } from './ncbi';
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
  source: SequencePackage['source'];
  meta: SequencePackage['meta'] | null;
  matches: MotifMatch[];
  notes: string[];
  error?: string;
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
  const gene = (req.gene || '').trim();
  if (!gene) throw new Error('Gene symbol is required.');
  const motif = validateMotif(req.motif || '');

  const flankBefore = clamp(req.flankBefore, 0, 500, 50);
  const flankAfter = clamp(req.flankAfter, 0, 500, 50);

  const species = req.species && req.species.length ? req.species : DEFAULT_SPECIES;
  const warnings: string[] = [];
  const results: SpeciesResult[] = [];

  // Run species lookups in parallel — they're independent network calls.
  const lookups = await Promise.all(
    species.map(async (sp): Promise<SpeciesResult> => {
      try {
        const pkg = await downloadSequence(gene, sp);
        const matches = findMotifMatches(pkg.promoterWindow, motif, {
          flankBefore,
          flankAfter,
        });
        return {
          species: sp,
          taxon: pkg.taxon,
          geneSymbol: pkg.geneSymbol,
          promoterWindow: pkg.promoterWindow,
          windowStart: pkg.windowStart,
          windowEnd: pkg.windowEnd,
          zeroPoint: pkg.zeroPoint,
          source: pkg.source,
          meta: pkg.meta,
          matches,
          notes: pkg.notes,
        };
      } catch (e) {
        const message = (e as Error).message;
        warnings.push(`${SPECIES_TAXON[sp]} (${gene.toUpperCase()}): ${message}`);
        return {
          species: sp,
          taxon: SPECIES_TAXON[sp],
          geneSymbol: gene.toUpperCase(),
          promoterWindow: '',
          windowStart: 0,
          windowEnd: 0,
          zeroPoint: 0,
          source: 'ncbi',
          meta: null,
          matches: [],
          notes: [],
          error: message,
        };
      }
    })
  );

  results.push(...lookups);

  // Use the official symbol from the first successful lookup so the response
  // shows the canonical form (e.g. user types "st3gal1" -> "ST3GAL1").
  const officialSymbol = results.find((r) => r.meta)?.geneSymbol || gene.toUpperCase();

  return { gene: officialSymbol, motif, flankBefore, flankAfter, results, warnings };
}

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
