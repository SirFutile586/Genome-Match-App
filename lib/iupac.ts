// IUPAC nucleotide ambiguity codes -> sets of concrete bases.
// Used to translate user motifs (which can include N, R, Y, etc., and the
// lowercase placeholder convention `n`) into a regex that matches against an
// uppercase DNA sequence.

export const IUPAC: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'T',
  R: '[AG]',
  Y: '[CT]',
  S: '[GC]',
  W: '[AT]',
  K: '[GT]',
  M: '[AC]',
  B: '[CGT]',
  D: '[AGT]',
  H: '[ACT]',
  V: '[ACG]',
  N: '[ACGT]',
};

/**
 * Convert an IUPAC motif like "TTCnnnGAA" into a regex pattern.
 * Lowercase `n` is treated identically to uppercase `N` for convenience.
 */
export function iupacToRegex(motif: string): RegExp {
  const cleaned = motif.trim().toUpperCase();
  if (!cleaned) {
    throw new Error('Motif is empty.');
  }
  let pattern = '';
  for (const ch of cleaned) {
    const expansion = IUPAC[ch];
    if (!expansion) {
      throw new Error(`Unsupported motif character: "${ch}"`);
    }
    pattern += expansion;
  }
  return new RegExp(pattern, 'g');
}

/**
 * Validate an IUPAC motif up front. Returns the cleaned (upper-cased) motif
 * or throws with a descriptive error.
 */
export function validateMotif(motif: string): string {
  const cleaned = motif.trim().toUpperCase();
  if (!cleaned) throw new Error('Motif is empty.');
  for (const ch of cleaned) {
    if (!IUPAC[ch]) {
      throw new Error(`Invalid IUPAC code "${ch}" in motif "${motif}".`);
    }
  }
  return cleaned;
}
