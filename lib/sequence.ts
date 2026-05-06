import { iupacToRegex, validateMotif } from './iupac';
import { designPrimerPairs, PrimerDesignParams, PrimerPair, SYBR_DEFAULTS } from './primer';

export interface MotifMatch {
  /** 1-based binding-site index within this gene/species (1, 2, 3, …). */
  index: number;
  position: number;     // 0-indexed start within the window
  end: number;          // exclusive end
  matched: string;      // the actual matched substring
  contextBefore: string;
  contextAfter: string;
  /**
   * Relative position of the motif's 5' edge from the TSS, in advisor-friendly
   * notation. Position 0 = TSS; values are negative because all matches sit
   * upstream of the TSS (e.g. -1234 means 1234 bp upstream). Computed as
   * `-(position + 1)` since window index 0 sits 1 bp upstream of the TSS.
   */
  relPositionFromTSS: number;
  /** Same convention applied to the 3' edge of the motif. */
  relEndFromTSS: number;
  /**
   * Exact 1-based genomic coordinates of the motif on the chromosome accession
   * recorded in `SequencePackage.meta`. start <= end; strand follows the gene.
   * Null when the species lookup failed (no meta).
   */
  genomicStart: number | null;
  genomicEnd: number | null;
  genomicStrand: 'plus' | 'minus' | null;
  /** ChIP-qPCR / SYBR Green primer candidates (up to 3) targeting this match. */
  primers: PrimerPair[];
}

export interface MotifSearchOptions {
  flankBefore?: number;
  flankAfter?: number;
  /**
   * Maximum allowed flank size on either side. The UI exposes 0..110 by
   * default but the engine accepts up to 500 to leave room for power users.
   */
  maxFlank?: number;
  /** Optional override of primer-design parameters (amplicon range, etc.). */
  primerParams?: PrimerDesignParams;
  /** Geometry needed to compute genomic coordinates for each match. */
  genomicAnchor?: GenomicAnchor;
}

export interface GenomicAnchor {
  tss: number;            // 1-based genomic position of the TSS
  strand: 'plus' | 'minus';
}

const DEFAULT_FLANK = 50;
const HARD_MAX_FLANK = 500;

/**
 * Find every IUPAC-aware match for `motif` within `sequence`.
 * Returns each match with configurable left/right context windows and (when
 * `genomicAnchor` is supplied) exact genomic coordinates of the matched motif.
 */
export function findMotifMatches(
  sequence: string,
  motif: string,
  options: MotifSearchOptions = {}
): MotifMatch[] {
  const before = clampFlank(options.flankBefore ?? DEFAULT_FLANK, options.maxFlank);
  const after = clampFlank(options.flankAfter ?? DEFAULT_FLANK, options.maxFlank);
  const primerParams = options.primerParams ?? SYBR_DEFAULTS;
  const anchor = options.genomicAnchor;

  validateMotif(motif);
  const re = iupacToRegex(motif);
  const upper = sequence.toUpperCase();

  const out: MotifMatch[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(upper)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const primers = designPrimerPairs(upper, start, end, primerParams);
    const relStart = -(start + 1);                  // bp from TSS, negative
    const relEnd = -(end);                          // 5' edge of motif's 3' boundary
    const genomic = anchor
      ? motifGenomicInterval(start, end, anchor)
      : { genomicStart: null, genomicEnd: null, genomicStrand: null as null };

    out.push({
      index: ++idx,
      position: start,
      end,
      matched: m[0],
      contextBefore: upper.slice(Math.max(0, start - before), start),
      contextAfter: upper.slice(end, Math.min(upper.length, end + after)),
      relPositionFromTSS: relStart,
      relEndFromTSS: relEnd,
      genomicStart: genomic.genomicStart,
      genomicEnd: genomic.genomicEnd,
      genomicStrand: genomic.genomicStrand,
      primers,
    });
    // Defensive: avoid infinite loops on zero-width matches.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * Map a motif occurrence at window indices [start, end) to its 1-based
 * genomic coordinates.
 *
 * The promoter window is assembled so that index 0 sits 1 bp upstream of the
 * TSS and indices grow as we move further upstream (transcript-strand
 * orientation). For minus-strand genes the displayed bases are already
 * reverse-complemented by NCBI, so window index → chromosome position uses
 * the opposite arithmetic.
 */
export function motifGenomicInterval(
  start: number,
  end: number,
  anchor: GenomicAnchor
): { genomicStart: number; genomicEnd: number; genomicStrand: 'plus' | 'minus' } {
  if (anchor.strand === 'plus') {
    // window index k (0-based) corresponds to chromosome position tss-1-k
    // The motif covers window [start, end) → chrom [tss-1-(end-1), tss-1-start]
    const gEnd = anchor.tss - 1 - start;       // closer to TSS
    const gStart = anchor.tss - 1 - (end - 1); // farther upstream
    return { genomicStart: gStart, genomicEnd: gEnd, genomicStrand: 'plus' };
  }
  // minus strand: window index k → chromosome position tss+1+k
  const gStart = anchor.tss + 1 + start;
  const gEnd = anchor.tss + 1 + (end - 1);
  return { genomicStart: gStart, genomicEnd: gEnd, genomicStrand: 'minus' };
}

function clampFlank(value: number, max?: number): number {
  const ceiling = Math.min(max ?? HARD_MAX_FLANK, HARD_MAX_FLANK);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), ceiling);
}

/**
 * Build a "target sequence package" for use with online primer design tools
 * (Primer3Plus / Primer-BLAST). The returned string is the substring of the
 * promoter window centered on the motif, padded by `leftFlank` / `rightFlank`
 * bases on each side, clipped to the sequence boundaries.
 *
 * The caller passes the raw promoter window (transcript-strand) and the
 * 0-based [matchStart, matchEnd) interval. We return the trimmed sequence and
 * the offset of the motif within the trimmed sequence so callers can produce
 * Primer3 SEQUENCE_TARGET / FASTA headers.
 */
export interface TargetWindow {
  sequence: string;
  /** 0-based start of the motif within `sequence`. */
  motifOffset: number;
  motifLength: number;
  leftFlank: number;
  rightFlank: number;
  /** Sliced window indices in the parent promoter window. */
  parentStart: number;
  parentEnd: number;
}

export function buildTargetWindow(
  promoterWindow: string,
  matchStart: number,
  matchEnd: number,
  leftFlank: number,
  rightFlank: number
): TargetWindow {
  const lf = Math.max(0, Math.floor(leftFlank));
  const rf = Math.max(0, Math.floor(rightFlank));
  const len = promoterWindow.length;
  const ms = Math.max(0, Math.min(len, matchStart));
  const me = Math.max(ms, Math.min(len, matchEnd));
  const start = Math.max(0, ms - lf);
  const end = Math.min(len, me + rf);
  const sliced = promoterWindow.slice(start, end);
  return {
    sequence: sliced,
    motifOffset: ms - start,
    motifLength: me - ms,
    leftFlank: ms - start,
    rightFlank: end - me,
    parentStart: start,
    parentEnd: end,
  };
}
