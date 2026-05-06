import { downloadSequence, Species, SPECIES_TAXON, SequencePackage } from './ncbi';
import { findMotifMatches, MotifMatch } from './sequence';
import { validateMotif } from './iupac';
import { PrimerDesignParams, SYBR_DEFAULTS } from './primer';

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
  /** Override min/max amplicon size (bp). Defaults: 100 / 250. */
  ampliconMin?: number;
  ampliconMax?: number;
}

export interface SearchResponse {
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  ampliconMin: number;
  ampliconMax: number;
  results: SpeciesResult[];
  warnings: string[];
}

/** Multi-gene panel request: same parameters, multiple genes. */
export interface PanelSearchRequest {
  genes: string[];
  motif: string;
  flankBefore?: number;
  flankAfter?: number;
  species?: Species[];
  ampliconMin?: number;
  ampliconMax?: number;
}

export interface PanelSearchResponse {
  motif: string;
  flankBefore: number;
  flankAfter: number;
  ampliconMin: number;
  ampliconMax: number;
  searches: SearchResponse[];
  warnings: string[];
}

const DEFAULT_SPECIES: Species[] = ['human', 'mouse'];

export async function runSearch(req: SearchRequest): Promise<SearchResponse> {
  const gene = (req.gene || '').trim();
  if (!gene) throw new Error('Gene symbol is required.');
  const motif = validateMotif(req.motif || '');

  const flankBefore = clamp(req.flankBefore, 0, 500, 50);
  const flankAfter = clamp(req.flankAfter, 0, 500, 50);

  const ampliconMin = clamp(req.ampliconMin, 50, 1000, SYBR_DEFAULTS.ampliconMin);
  const ampliconMaxRaw = clamp(req.ampliconMax, 50, 1000, SYBR_DEFAULTS.ampliconMax);
  const ampliconMax = Math.max(ampliconMin + 1, ampliconMaxRaw);
  const primerParams: PrimerDesignParams = {
    ...SYBR_DEFAULTS,
    ampliconMin,
    ampliconMax,
  };

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
          primerParams,
          genomicAnchor: { tss: pkg.meta.tss, strand: pkg.meta.strand },
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

  return {
    gene: officialSymbol,
    motif,
    flankBefore,
    flankAfter,
    ampliconMin,
    ampliconMax,
    results,
    warnings,
  };
}

/**
 * Run the same motif search across many genes in one request — the panel
 * mode the lab advisor asked for. Each gene gets its own SearchResponse so
 * the UI can either render them as individual tabs OR build a comparison
 * table from the union of results.
 *
 * Genes are de-duplicated case-insensitively to avoid double-pulling the
 * same NCBI record. We run gene lookups in parallel but cap the concurrency
 * so we don't fire 50 EFetch calls at once on a long panel.
 */
const PANEL_CONCURRENCY = 4;

export async function runPanelSearch(req: PanelSearchRequest): Promise<PanelSearchResponse> {
  const motif = validateMotif(req.motif || '');
  const seen = new Set<string>();
  const genes = (req.genes || [])
    .map((g) => (g || '').trim())
    .filter(Boolean)
    .filter((g) => {
      const key = g.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!genes.length) throw new Error('At least one gene symbol is required.');

  const flankBefore = clamp(req.flankBefore, 0, 500, 50);
  const flankAfter = clamp(req.flankAfter, 0, 500, 50);
  const ampliconMin = clamp(req.ampliconMin, 50, 1000, SYBR_DEFAULTS.ampliconMin);
  const ampliconMaxRaw = clamp(req.ampliconMax, 50, 1000, SYBR_DEFAULTS.ampliconMax);
  const ampliconMax = Math.max(ampliconMin + 1, ampliconMaxRaw);

  const warnings: string[] = [];
  const searches: SearchResponse[] = new Array(genes.length);

  // Simple bounded-concurrency worker pool.
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= genes.length) return;
      try {
        searches[i] = await runSearch({
          gene: genes[i],
          motif,
          flankBefore,
          flankAfter,
          species: req.species,
          ampliconMin,
          ampliconMax,
        });
      } catch (e) {
        const msg = (e as Error).message;
        warnings.push(`${genes[i]}: ${msg}`);
        searches[i] = {
          gene: genes[i].toUpperCase(),
          motif,
          flankBefore,
          flankAfter,
          ampliconMin,
          ampliconMax,
          results: [],
          warnings: [msg],
        };
      }
    }
  }
  const workers = Array.from({ length: Math.min(PANEL_CONCURRENCY, genes.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  return {
    motif,
    flankBefore,
    flankAfter,
    ampliconMin,
    ampliconMax,
    searches,
    warnings,
  };
}

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
