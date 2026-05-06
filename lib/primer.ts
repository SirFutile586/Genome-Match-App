// Heuristic primer-pair picker for ChIP-qPCR by SYBR Green.
//
// This is intentionally a transparent, dependency-free heuristic: there is
// no Primer3 binary or wasm in the bundle. Every candidate must still be
// validated in a wet lab and against Primer-BLAST / UCSC In-Silico PCR for
// genome-wide specificity before use. The scoring captures the well-known
// SYBR-friendly defaults documented in the README.
//
// Defaults (ChIP-qPCR / SYBR Green wide window):
//   - Amplicon size: 100–250 bp
//   - Primer length: 18–24 nt
//   - Tm:            ~60 °C (target 60, accept 57–63)
//   - GC%:           40–60 %
//   - Avoid runs of >=4 of the same base, GC clamp on 3' end (1–2 G/C in
//     the last 5 nt, no more than 3), no di-nuc repeats >=4
//
// Strategy:
//   The motif match anchors the centre of the desired amplicon. We slide the
//   forward primer through the upstream flank and the reverse primer through
//   the downstream flank, requiring that the amplicon straddles the motif
//   and stays inside [100, 250] bp. We pick the top-scoring non-overlapping
//   pairs (up to 3) and surface a one-line warning per pair when any
//   parameter falls outside the SYBR-friendly comfort band.

export interface PrimerCandidate {
  sequence: string;          // 5'->3' as it would be ordered
  start: number;             // start in the promoter window (0-based, inclusive)
  end: number;               // exclusive end in the promoter window
  length: number;
  tm: number;                // approximate Tm in °C
  gc: number;                // GC fraction in 0..1
  warnings: string[];        // human-readable issues, e.g. "GC 38% is below 40%"
}

export interface PrimerPair {
  forward: PrimerCandidate;
  reverse: PrimerCandidate; // reverse.sequence is already reverse-complemented (standard primer order)
  ampliconStart: number;     // forward.start
  ampliconEnd: number;       // reverse.end (exclusive) on the template strand
  ampliconSize: number;
  tmDelta: number;           // |fwd.tm - rev.tm|
  score: number;             // higher is better
  warnings: string[];        // pair-level warnings
}

export interface PrimerDesignParams {
  ampliconMin: number;
  ampliconMax: number;
  primerMin: number;
  primerMax: number;
  tmTarget: number;
  tmMin: number;
  tmMax: number;
  gcMin: number;             // fraction (0.40)
  gcMax: number;             // fraction (0.60)
  maxPairs: number;
  /** maximum |fwd.tm - rev.tm| we tolerate */
  maxTmDelta: number;
  /** minimum gap (nt) between the 3' end of the forward primer and the start of the reverse primer */
  minInnerGap: number;
}

export const SYBR_DEFAULTS: PrimerDesignParams = {
  ampliconMin: 100,
  ampliconMax: 250,
  primerMin: 18,
  primerMax: 24,
  tmTarget: 60,
  tmMin: 57,
  tmMax: 63,
  gcMin: 0.4,
  gcMax: 0.6,
  maxPairs: 3,
  maxTmDelta: 2.5,
  minInnerGap: 1,
};

const VALID_DNA = /^[ACGT]+$/;

/**
 * Design up to `params.maxPairs` primer pairs around a motif match.
 *
 * `template` is the motif-strand promoter window (the same string the UI
 * renders). `motifStart`/`motifEnd` are 0-based positions in that window.
 * Note: positions in the rest of the app increase moving *upstream* of the
 * TSS. Primer indices in this module use the same convention so the caller
 * can render them directly.
 */
export function designPrimerPairs(
  template: string,
  motifStart: number,
  motifEnd: number,
  params: PrimerDesignParams = SYBR_DEFAULTS
): PrimerPair[] {
  const seq = (template || '').toUpperCase();
  if (!seq) return [];
  if (motifStart < 0 || motifEnd > seq.length || motifStart >= motifEnd) return [];

  // Need at least the smallest amplicon to be feasible.
  if (seq.length < params.ampliconMin) return [];

  // Forward primer must end before motifStart; reverse primer must start
  // at/after motifEnd. We slide both ends and keep amplicons in range.
  const fwdCandidates: PrimerCandidate[] = [];
  const revCandidates: PrimerCandidate[] = [];

  for (let len = params.primerMin; len <= params.primerMax; len++) {
    // Forward primer: 5'->3' on the template, ending at most at motifStart.
    // Allow forward primer to overlap motif up to its 5' edge — but for
    // ChIP-qPCR convention we keep the primer outside the binding site.
    const fwdEndMax = motifStart;          // exclusive
    const fwdStartMin = Math.max(0, motifStart - params.ampliconMax + 1);
    const fwdStartMax = fwdEndMax - len;   // inclusive
    for (let s = fwdStartMin; s <= fwdStartMax; s++) {
      const e = s + len;
      const sub = seq.slice(s, e);
      if (!VALID_DNA.test(sub)) continue;
      const cand = scorePrimer(sub, s, e, params);
      if (cand) fwdCandidates.push(cand);
    }

    // Reverse primer: occupies positions [s, s+len) on the template; the
    // ordered primer sequence is the reverse complement of that substring.
    const revStartMin = motifEnd;
    const revStartMax = Math.min(seq.length - len, motifEnd + params.ampliconMax - 1);
    for (let s = revStartMin; s <= revStartMax; s++) {
      const e = s + len;
      const sub = seq.slice(s, e);
      if (!VALID_DNA.test(sub)) continue;
      const ordered = reverseComplement(sub);
      const cand = scorePrimer(ordered, s, e, params);
      if (cand) revCandidates.push(cand);
    }
  }

  if (!fwdCandidates.length || !revCandidates.length) return [];

  // Pair scoring: amplicon-size fit + |tm delta| + each primer's own score.
  const pairs: PrimerPair[] = [];
  for (const f of fwdCandidates) {
    for (const r of revCandidates) {
      if (r.start - f.end < params.minInnerGap) continue;
      const ampSize = r.end - f.start;
      if (ampSize < params.ampliconMin || ampSize > params.ampliconMax) continue;
      const tmDelta = Math.abs(f.tm - r.tm);
      if (tmDelta > params.maxTmDelta) continue;

      const sizeMid = (params.ampliconMin + params.ampliconMax) / 2;
      const sizePenalty = Math.abs(ampSize - sizeMid) / (params.ampliconMax - params.ampliconMin);
      const score =
        100
        - 8 * tmDelta
        - 6 * (Math.abs(f.tm - params.tmTarget) + Math.abs(r.tm - params.tmTarget))
        - 4 * (f.warnings.length + r.warnings.length)
        - 12 * sizePenalty;

      const pairWarnings: string[] = [];
      if (tmDelta > 1.5) pairWarnings.push(`Tm mismatch ${tmDelta.toFixed(1)} °C`);
      if (ampSize < 120 || ampSize > 220) pairWarnings.push(`amplicon ${ampSize} bp at edge of qPCR window`);

      pairs.push({
        forward: f,
        reverse: r,
        ampliconStart: f.start,
        ampliconEnd: r.end,
        ampliconSize: ampSize,
        tmDelta,
        score,
        warnings: pairWarnings,
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  // Avoid returning multiple near-identical pairs.
  const accepted: PrimerPair[] = [];
  for (const p of pairs) {
    if (accepted.length >= params.maxPairs) break;
    const overlapping = accepted.some(
      (q) =>
        Math.abs(q.forward.start - p.forward.start) < 5 &&
        Math.abs(q.reverse.end - p.reverse.end) < 5
    );
    if (overlapping) continue;
    accepted.push(p);
  }
  return accepted;
}

function scorePrimer(
  sequence: string,
  start: number,
  end: number,
  params: PrimerDesignParams
): PrimerCandidate | null {
  const len = sequence.length;
  if (len < params.primerMin || len > params.primerMax) return null;
  const gcCount = countGC(sequence);
  const gc = gcCount / len;
  const tm = approximateTm(sequence);

  const warnings: string[] = [];
  if (gc < params.gcMin) warnings.push(`GC ${(gc * 100).toFixed(0)}% < ${(params.gcMin * 100).toFixed(0)}%`);
  if (gc > params.gcMax) warnings.push(`GC ${(gc * 100).toFixed(0)}% > ${(params.gcMax * 100).toFixed(0)}%`);
  if (tm < params.tmMin) warnings.push(`Tm ${tm.toFixed(1)} °C < ${params.tmMin} °C`);
  if (tm > params.tmMax) warnings.push(`Tm ${tm.toFixed(1)} °C > ${params.tmMax} °C`);
  if (/(.)\1{3,}/.test(sequence)) warnings.push('homopolymer run ≥4');
  const last5 = sequence.slice(-5);
  const last5GC = countGC(last5);
  if (last5GC === 0) warnings.push("no GC clamp at 3' end");
  if (last5GC > 3) warnings.push("strong GC clamp (>3 G/C in last 5 nt)");
  if (/(GC|AT|TA|CG){4,}/.test(sequence)) warnings.push('dinucleotide repeat ≥4');

  // Reject only catastrophic failures so the UI still gets *something* to
  // show on tricky promoters; surface every other issue as a warning.
  if (gc < 0.2 || gc > 0.8) return null;
  if (tm < 50 || tm > 75) return null;

  return { sequence, start, end, length: len, tm, gc, warnings };
}

function countGC(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 71 /* G */ || c === 67 /* C */) n++;
  }
  return n;
}

/**
 * Approximate Tm using the salt-adjusted nearest-neighbour-free formula:
 *   Tm = 64.9 + 41 * (gc - 16.4) / length
 * which is the standard SYBR-friendly back-of-envelope for primers in the
 * 18–30 nt range. For shorter primers we fall back to the 4+2 rule
 * (Tm = 4*GC + 2*AT) which is appropriate for very short oligos.
 */
function approximateTm(seq: string): number {
  const len = seq.length;
  const gc = countGC(seq);
  if (len < 14) {
    return 4 * gc + 2 * (len - gc);
  }
  return 64.9 + (41 * (gc - 16.4)) / len;
}

export function reverseComplement(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i--) {
    out += COMPLEMENT[seq[i]] || 'N';
  }
  return out;
}

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  T: 'A',
  C: 'G',
  G: 'C',
  N: 'N',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  U: 'A',
};
