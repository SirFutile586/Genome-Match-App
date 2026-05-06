// Real NCBI-backed promoter sequence retrieval.
//
// Pipeline:
//   1. Resolve gene symbol + species (Homo sapiens / Mus musculus) to a
//      transcript record on the pinned reference assembly (GRCh38 / GRCm39)
//      via the NCBI Datasets v2 product_report endpoint.
//   2. Pick the canonical transcript: prefer MANE Select; otherwise the
//      longest RefSeq protein-coding transcript ("NM_*"); otherwise the
//      longest predicted protein-coding transcript ("XM_*"). The choice is
//      reported back so the UI can show fallback behavior.
//   3. Use the chosen transcript's first exon on the pinned assembly to
//      locate the genomic TSS. For a plus-strand transcript, TSS is the
//      smaller (begin) coordinate of exon order=1; for minus strand, TSS is
//      the larger (end) coordinate of exon order=1.
//   4. Compute the upstream interval:
//        plus  : [TSS - 10000, TSS - 1]  (genomic plus strand)
//        minus : [TSS + 1, TSS + 10000]  (genomic plus strand, reverse-comp)
//      Then EFetch nuccore for that range with strand=1 (plus) or strand=2
//      (minus) and reverse the returned 5'->3' string so that array index 0
//      corresponds to the base immediately adjacent to the TSS and indices
//      grow as we move upstream (matching the "0 bp = TSS, positions
//      increasing upstream to 10,000 bp" UI convention).
//
// Endpoints used (no API key required, but NCBI_API_KEY is honored if set):
//   https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/{symbol}/taxon/{taxid}/product_report
//   https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
//
// Both endpoints work from Node.js / Vercel serverless. CORS makes them
// awkward to hit from the browser, so all fetching happens server-side via
// /api/sequence and /api/search.

export type Species = 'human' | 'mouse';

export interface SequencePackage {
  species: Species;
  taxon: string;
  geneSymbol: string;

  /**
   * 10,000 bp upstream of the canonical TSS, on the transcript strand,
   * arranged so that index 0 sits closest to the TSS (1 bp upstream) and
   * index 9999 sits 10,000 bp upstream. This matches the app's
   * "0 bp = TSS, positions increasing upstream" coordinate system.
   */
  promoterWindow: string;
  windowStart: number;
  windowEnd: number;
  zeroPoint: number;

  source: 'ncbi';

  // Real-source metadata. All fields are filled in for the live NCBI path.
  meta: {
    assembly: string;
    assemblyAccession: string;
    chromosomeAccession: string;
    geneId: string;
    transcriptAccession: string;
    transcriptName: string | null;
    transcriptSelectCategory: 'MANE_SELECT' | 'RefSeq_Select' | null;
    transcriptIsFallback: boolean;
    fallbackReason: string | null;
    strand: 'plus' | 'minus';
    tss: number;                       // 1-based genomic position of TSS
    upstreamGenomicStart: number;      // 1-based inclusive
    upstreamGenomicEnd: number;        // 1-based inclusive
    fetchedAt: string;                 // ISO timestamp
  };

  notes: string[];
}

export const SPECIES_TAXON: Record<Species, string> = {
  human: 'Homo sapiens',
  mouse: 'Mus musculus (house mouse)',
};

/**
 * Pinned reference assemblies. These are configurable via env vars in case
 * the user revisits the choice (e.g. to follow GENCODE/Ensembl rather than
 * NCBI annotation cycles).
 */
export const ASSEMBLY: Record<Species, { name: string; accession: string; taxId: string }> = {
  human: {
    name: process.env.NCBI_HUMAN_ASSEMBLY_NAME || 'GRCh38',
    accession: process.env.NCBI_HUMAN_ASSEMBLY_ACCESSION || 'GCF_000001405.40',
    taxId: '9606',
  },
  mouse: {
    name: process.env.NCBI_MOUSE_ASSEMBLY_NAME || 'GRCm39',
    accession: process.env.NCBI_MOUSE_ASSEMBLY_ACCESSION || 'GCF_000001635.27',
    taxId: '10090',
  },
};

const PROMOTER_LENGTH = 10_000;

const DATASETS_BASE = 'https://api.ncbi.nlm.nih.gov/datasets/v2';
const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const FETCH_TIMEOUT_MS = 25_000;

interface ExonRecord {
  begin: string;
  end: string;
  orientation: 'plus' | 'minus';
  order: number;
}

interface GenomicLocation {
  genomic_accession_version: string;
  sequence_name?: string;
  genomic_range: { begin: string; end: string; orientation?: 'plus' | 'minus' };
  exons?: ExonRecord[];
}

interface TranscriptRecord {
  accession_version: string;
  name?: string;
  length?: number;
  type?: string;
  select_category?: 'MANE_SELECT' | 'RefSeq_Select' | string;
  genomic_locations?: GenomicLocation[];
}

interface ProductReportResponse {
  reports?: Array<{
    product?: {
      gene_id?: string;
      symbol?: string;
      transcripts?: TranscriptRecord[];
    };
  }>;
}

interface GeneAnnotation {
  assembly_accession?: string;
  assembly_name?: string;
  genomic_locations?: GenomicLocation[];
}

interface GeneReportResponse {
  reports?: Array<{
    gene?: {
      gene_id?: string;
      symbol?: string;
      orientation?: 'plus' | 'minus';
      annotations?: GeneAnnotation[];
    };
  }>;
}

export async function downloadSequence(
  geneSymbolInput: string,
  species: Species
): Promise<SequencePackage> {
  const symbol = (geneSymbolInput || '').trim();
  if (!symbol) throw new Error('Gene symbol is required.');
  if (species !== 'human' && species !== 'mouse') {
    throw new Error(`Unsupported species: ${species}`);
  }

  const assembly = ASSEMBLY[species];
  const product = await fetchProductReport(symbol, assembly.taxId);

  const transcripts = product?.reports?.[0]?.product?.transcripts || [];
  if (!transcripts.length) {
    throw new Error(
      `No transcripts returned by NCBI Datasets for ${symbol} (taxid ${assembly.taxId}). ` +
        `Check that the gene symbol is valid for ${SPECIES_TAXON[species]}.`
    );
  }

  const geneId = product?.reports?.[0]?.product?.gene_id || '';
  const officialSymbol = product?.reports?.[0]?.product?.symbol || symbol.toUpperCase();

  const picked = pickTranscript(transcripts, assembly.name);
  if (!picked) {
    throw new Error(
      `${officialSymbol}: no transcript with a usable mapping on ${assembly.name} ` +
        `(${assembly.accession}). The gene may only be annotated on an alternate assembly.`
    );
  }

  const { transcript } = picked;
  let { location, fallbackReason } = picked;

  // If the picked transcript has no exon-level mapping (a known gap in the
  // Datasets product_report endpoint for some curated RefSeq Select records),
  // fall back to gene-level annotation on the same assembly so we can still
  // anchor the TSS at the gene boundary. Document the imprecision.
  if (!(location?.exons && location.exons.length)) {
    const geneLoc = await fetchGeneAssemblyLocation(geneId, assembly.name);
    if (!geneLoc) {
      throw new Error(
        `${officialSymbol}: transcript ${transcript.accession_version} has no exon ` +
          `mapping in product_report and no gene-level annotation on ${assembly.name}.`
      );
    }
    location = geneLoc;
    const note =
      `Transcript ${transcript.accession_version} lacks exon-level coordinates in NCBI Datasets product_report; ` +
      `anchoring at the gene-level 5' boundary on ${assembly.name} instead.`;
    fallbackReason = fallbackReason ? `${fallbackReason} ${note}` : note;
  }

  const exons = location.exons || [];
  let orientation: 'plus' | 'minus';
  let tss: number;

  if (exons.length) {
    const firstExon = exons.find((e) => e.order === 1) || exons[0];
    orientation =
      (firstExon.orientation as 'plus' | 'minus') ||
      (location.genomic_range.orientation as 'plus' | 'minus') ||
      'plus';
    const exonBegin = parseInt(firstExon.begin, 10);
    const exonEnd = parseInt(firstExon.end, 10);
    if (!Number.isFinite(exonBegin) || !Number.isFinite(exonEnd)) {
      throw new Error(
        `${officialSymbol}: malformed exon coordinates (${firstExon.begin}, ${firstExon.end}).`
      );
    }
    tss = orientation === 'plus' ? exonBegin : exonEnd;
  } else {
    // No exons even after fallback: anchor at the gene's outer 5' boundary.
    orientation = (location.genomic_range.orientation as 'plus' | 'minus') || 'plus';
    const rangeBegin = parseInt(location.genomic_range.begin, 10);
    const rangeEnd = parseInt(location.genomic_range.end, 10);
    if (!Number.isFinite(rangeBegin) || !Number.isFinite(rangeEnd)) {
      throw new Error(
        `${officialSymbol}: malformed gene boundary coordinates ` +
          `(${location.genomic_range.begin}, ${location.genomic_range.end}).`
      );
    }
    tss = orientation === 'plus' ? rangeBegin : rangeEnd;
  }

  let upstreamStart: number;
  let upstreamEnd: number;
  let strandParam: 1 | 2;
  if (orientation === 'plus') {
    upstreamStart = Math.max(1, tss - PROMOTER_LENGTH);
    upstreamEnd = tss - 1;
    strandParam = 1;
  } else {
    upstreamStart = tss + 1;
    upstreamEnd = tss + PROMOTER_LENGTH;
    strandParam = 2;
  }

  if (upstreamEnd < upstreamStart) {
    throw new Error(
      `${officialSymbol}: degenerate upstream interval (TSS=${tss}, strand=${orientation}).`
    );
  }

  const accession = location.genomic_accession_version;
  const rawSeq = await fetchUpstreamSequence(accession, upstreamStart, upstreamEnd, strandParam);

  // EFetch returns the requested range in transcript 5'->3' order. Reverse it
  // so that array index 0 sits immediately adjacent to the TSS and indices
  // grow as we move upstream (the app's coordinate convention).
  const promoterWindow = reverseString(rawSeq);

  const notes: string[] = [
    `Assembly: ${assembly.name} (${assembly.accession}). Configurable via NCBI_HUMAN_ASSEMBLY_* / NCBI_MOUSE_ASSEMBLY_* env vars.`,
    `Transcript ${transcript.accession_version}${
      transcript.select_category ? ` (${transcript.select_category})` : ''
    } anchors the TSS at ${accession}:${tss} on the ${orientation} strand.`,
    `Window: ${accession}:${upstreamStart}-${upstreamEnd} (${orientation} strand), ` +
      `${promoterWindow.length} bp returned. Index 0 = 1 bp upstream of TSS; index ${
        promoterWindow.length - 1
      } = ${promoterWindow.length} bp upstream.`,
  ];
  if (fallbackReason) notes.push(`Transcript fallback: ${fallbackReason}`);

  return {
    species,
    taxon: SPECIES_TAXON[species],
    geneSymbol: officialSymbol,
    promoterWindow,
    windowStart: 0,
    windowEnd: promoterWindow.length,
    zeroPoint: 0,
    source: 'ncbi',
    meta: {
      assembly: assembly.name,
      assemblyAccession: assembly.accession,
      chromosomeAccession: accession,
      geneId,
      transcriptAccession: transcript.accession_version,
      transcriptName: transcript.name || null,
      transcriptSelectCategory: normalizeSelectCategory(transcript.select_category),
      transcriptIsFallback: normalizeSelectCategory(transcript.select_category) === null,
      fallbackReason,
      strand: orientation,
      tss,
      upstreamGenomicStart: upstreamStart,
      upstreamGenomicEnd: upstreamEnd,
      fetchedAt: new Date().toISOString(),
    },
    notes,
  };
}

async function fetchGeneAssemblyLocation(
  geneId: string,
  assemblyName: string
): Promise<GenomicLocation | null> {
  if (!geneId) return null;
  const url = `${DATASETS_BASE}/gene/id/${encodeURIComponent(geneId)}`;
  const res = await ncbiFetch(url, { accept: 'application/json' });
  if (!res.ok) return null;
  const json = (await res.json()) as GeneReportResponse;
  const gene = json?.reports?.[0]?.gene;
  if (!gene) return null;

  for (const ann of gene.annotations || []) {
    if ((ann.assembly_name || '').toLowerCase().includes(assemblyName.toLowerCase())) {
      const loc = (ann.genomic_locations || [])[0];
      if (loc) {
        return {
          genomic_accession_version: loc.genomic_accession_version,
          sequence_name: loc.sequence_name,
          genomic_range: {
            begin: loc.genomic_range.begin,
            end: loc.genomic_range.end,
            orientation:
              (loc.genomic_range.orientation as 'plus' | 'minus') ||
              (gene.orientation as 'plus' | 'minus') ||
              'plus',
          },
          exons: loc.exons,
        };
      }
    }
  }
  return null;
}

async function fetchProductReport(symbol: string, taxId: string): Promise<ProductReportResponse> {
  const url = `${DATASETS_BASE}/gene/symbol/${encodeURIComponent(symbol)}/taxon/${encodeURIComponent(
    taxId
  )}/product_report`;
  const res = await ncbiFetch(url, { accept: 'application/json' });
  if (res.status === 404) {
    throw new Error(`Gene symbol "${symbol}" not found for taxid ${taxId} in NCBI Datasets.`);
  }
  if (!res.ok) {
    throw new Error(`NCBI Datasets product_report failed: HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as ProductReportResponse;
  return json;
}

interface PickedTranscript {
  transcript: TranscriptRecord;
  location: GenomicLocation;
  fallbackReason: string | null;
}

/**
 * Pick the canonical transcript on the pinned assembly, with documented
 * fallbacks. We score in priority order:
 *   1. select_category === "MANE_SELECT" with a location on this assembly
 *   2. select_category === "RefSeq_Select" with a location on this assembly
 *   3. Curated RefSeq mRNA (NM_*) with a location on this assembly,
 *      preferring longer transcripts.
 *   4. Predicted RefSeq mRNA (XM_*) with a location on this assembly,
 *      preferring longer transcripts.
 */
function pickTranscript(
  transcripts: TranscriptRecord[],
  assemblyName: string
): PickedTranscript | null {
  const onAssembly = (t: TranscriptRecord): GenomicLocation | null => {
    for (const loc of t.genomic_locations || []) {
      const seqName = (loc.sequence_name || '').toLowerCase();
      if (seqName.includes(assemblyName.toLowerCase())) return loc;
    }
    for (const loc of t.genomic_locations || []) {
      if (/^NC_/i.test(loc.genomic_accession_version)) return loc;
    }
    return null;
  };

  // Sentinel "no genomic_locations were returned for this transcript" location.
  // The downloadSequence flow detects this and resolves coordinates via
  // gene-level annotation as a fallback.
  const stub = (): GenomicLocation => ({
    genomic_accession_version: '',
    genomic_range: { begin: '0', end: '0' },
  });

  // NCBI returns select_category in mixed casing across endpoints
  // ("MANE_SELECT", "REFSEQ_SELECT", "RefSeq_Select"). Normalize for matching.
  const sel = (t: TranscriptRecord) => (t.select_category || '').toUpperCase();

  // 1. MANE Select
  for (const t of transcripts) {
    if (sel(t) === 'MANE_SELECT') {
      const loc = onAssembly(t);
      if (loc) return { transcript: t, location: loc, fallbackReason: null };
      // Even without per-transcript locations, accept the MANE pick and let
      // the gene-level fallback provide coordinates.
      return { transcript: t, location: stub(), fallbackReason: null };
    }
  }

  // 2. RefSeq Select
  for (const t of transcripts) {
    if (sel(t) === 'REFSEQ_SELECT' || sel(t) === 'REFSEQSELECT') {
      const loc = onAssembly(t);
      if (loc) {
        return {
          transcript: t,
          location: loc,
          fallbackReason: 'No MANE Select transcript available; using RefSeq Select.',
        };
      }
      return {
        transcript: t,
        location: stub(),
        fallbackReason: 'No MANE Select transcript available; using RefSeq Select.',
      };
    }
  }

  const lengthOf = (t: TranscriptRecord) => (typeof t.length === 'number' ? t.length : 0);

  // 3. Curated RefSeq (NM_*)
  const nm = transcripts
    .filter((t) => /^NM_/i.test(t.accession_version || ''))
    .filter((t) => onAssembly(t) !== null)
    .sort((a, b) => lengthOf(b) - lengthOf(a));
  if (nm.length) {
    const t = nm[0];
    const loc = onAssembly(t)!;
    return {
      transcript: t,
      location: loc,
      fallbackReason:
        'No MANE/RefSeq Select annotation; using the longest curated RefSeq mRNA (NM_*).',
    };
  }

  // 4. Predicted RefSeq (XM_*)
  const xm = transcripts
    .filter((t) => /^XM_/i.test(t.accession_version || ''))
    .filter((t) => onAssembly(t) !== null)
    .sort((a, b) => lengthOf(b) - lengthOf(a));
  if (xm.length) {
    const t = xm[0];
    const loc = onAssembly(t)!;
    return {
      transcript: t,
      location: loc,
      fallbackReason:
        'No curated RefSeq mRNA (NM_*); falling back to the longest predicted model (XM_*). Coordinates may shift between annotation releases.',
    };
  }

  return null;
}

async function fetchUpstreamSequence(
  accession: string,
  start: number,
  stop: number,
  strand: 1 | 2
): Promise<string> {
  const params = new URLSearchParams({
    db: 'nuccore',
    id: accession,
    seq_start: String(start),
    seq_stop: String(stop),
    strand: String(strand),
    rettype: 'fasta',
    retmode: 'text',
  });
  const apiKey = process.env.NCBI_API_KEY;
  if (apiKey) params.set('api_key', apiKey);
  const url = `${EUTILS_BASE}/efetch.fcgi?${params.toString()}`;

  const res = await ncbiFetch(url, { accept: 'text/plain' });
  if (!res.ok) {
    throw new Error(`NCBI EFetch failed for ${accession}:${start}-${stop}: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseFasta(text);
}

function parseFasta(text: string): string {
  const lines = text.split(/\r?\n/);
  const seq: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith('>') || line.startsWith(';')) continue;
    seq.push(line.trim().toUpperCase());
  }
  const joined = seq.join('').replace(/\s+/g, '');
  if (!joined) {
    throw new Error('NCBI returned an empty FASTA payload (no sequence body).');
  }
  if (!/^[ACGTRYSWKMBDHVN]+$/.test(joined)) {
    throw new Error('NCBI FASTA contained unexpected characters; refusing to use as DNA sequence.');
  }
  return joined;
}

function normalizeSelectCategory(
  raw: string | undefined
): 'MANE_SELECT' | 'RefSeq_Select' | null {
  const u = (raw || '').toUpperCase();
  if (u === 'MANE_SELECT') return 'MANE_SELECT';
  if (u === 'REFSEQ_SELECT' || u === 'REFSEQSELECT') return 'RefSeq_Select';
  return null;
}

function reverseString(s: string): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}

async function ncbiFetch(url: string, opts: { accept?: string } = {}): Promise<Response> {
  const apiKey = process.env.NCBI_API_KEY;
  // Datasets v2 supports api-key via header; EFetch already gets it via query.
  // We add it to the header too so both paths benefit when the key is set.
  const headers: Record<string, string> = {
    'user-agent': 'genome-match-app/1.0 (+https://github.com/SirFutile586/Genome-Match-App)',
  };
  if (opts.accept) headers['accept'] = opts.accept;
  if (apiKey) headers['api-key'] = apiKey;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new Error(`NCBI request timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
    }
    throw new Error(`NCBI request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
