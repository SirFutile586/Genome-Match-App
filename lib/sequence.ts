import { iupacToRegex, validateMotif } from './iupac';
import { designPrimerPairs, PrimerPair, SYBR_DEFAULTS } from './primer';

export interface MotifMatch {
  position: number;     // 0-indexed start within the window
  end: number;          // exclusive end
  matched: string;      // the actual matched substring
  contextBefore: string;
  contextAfter: string;
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
}

const DEFAULT_FLANK = 50;
const HARD_MAX_FLANK = 500;

/**
 * Find every IUPAC-aware match for `motif` within `sequence`.
 * Returns each match with configurable left/right context windows.
 */
export function findMotifMatches(
  sequence: string,
  motif: string,
  options: MotifSearchOptions = {}
): MotifMatch[] {
  const before = clampFlank(options.flankBefore ?? DEFAULT_FLANK, options.maxFlank);
  const after = clampFlank(options.flankAfter ?? DEFAULT_FLANK, options.maxFlank);

  validateMotif(motif);
  const re = iupacToRegex(motif);
  const upper = sequence.toUpperCase();

  const out: MotifMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const primers = designPrimerPairs(upper, start, end, SYBR_DEFAULTS);
    out.push({
      position: start,
      end,
      matched: m[0],
      contextBefore: upper.slice(Math.max(0, start - before), start),
      contextAfter: upper.slice(end, Math.min(upper.length, end + after)),
      primers,
    });
    // Defensive: avoid infinite loops on zero-width matches.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function clampFlank(value: number, max?: number): number {
  const ceiling = Math.min(max ?? HARD_MAX_FLANK, HARD_MAX_FLANK);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), ceiling);
}
