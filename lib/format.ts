// Shared formatting helpers for advisor-friendly position notation, FASTA
// generation, and target-window labelling.

import type { MotifMatch } from './sequence';
import type { SequencePackage } from './ncbi';

/**
 * Render a relative position from TSS as a signed bp string. We always
 * show the sign so "-1234 bp from TSS" is unambiguous in reports.
 */
export function formatRelPosition(rel: number): string {
  if (rel === 0) return '0 bp (TSS)';
  const sign = rel > 0 ? '+' : '−';
  return `${sign}${Math.abs(rel).toLocaleString()} bp`;
}

/**
 * Compact "general position" bucket the advisor asked for (e.g.
 * "around -1000 bp"). Bucket size grows with distance so distant matches
 * don't all collapse to one label.
 */
export function bucketRelPosition(rel: number): string {
  const abs = Math.abs(rel);
  let bucket: number;
  if (abs <= 500) bucket = 100;
  else if (abs <= 2000) bucket = 250;
  else if (abs <= 5000) bucket = 500;
  else bucket = 1000;
  const rounded = Math.round(rel / bucket) * bucket;
  return `~${rounded.toLocaleString()} bp`;
}

export interface TargetFastaOptions {
  gene: string;
  taxon: string;
  motifLabel: string;
  motifIndex: number;
  match: MotifMatch;
  meta: SequencePackage['meta'];
  sequence: string;
  leftFlank: number;
  rightFlank: number;
  motifOffset: number;
  motifLength: number;
}

/** Width of FASTA sequence lines (NCBI convention is 60 or 80). */
const FASTA_WRAP = 60;

/**
 * Build a multi-line FASTA block describing the target region. The header
 * line packs gene, species, motif index, relative position, exact genomic
 * interval, transcript accession, assembly, strand, and the motif offset
 * inside the target window so the user can paste it directly into Primer3
 * or Primer-BLAST.
 */
export function buildTargetFasta(opts: TargetFastaOptions): string {
  const { gene, taxon, motifLabel, motifIndex, match, meta, sequence } = opts;
  const headerParts: string[] = [
    `${gene}`,
    `species=${taxon.replace(/\s+/g, '_')}`,
    `motif=${motifLabel}`,
    `binding_site=${motifIndex}`,
    `rel_position=${formatRelPosition(match.relPositionFromTSS)}`,
    `target_window=${opts.leftFlank}+${opts.motifLength}+${opts.rightFlank}_bp`,
    `motif_offset=${opts.motifOffset}-${opts.motifOffset + opts.motifLength}`,
  ];
  if (meta) {
    headerParts.push(
      `transcript=${meta.transcriptAccession}`,
      `assembly=${meta.assembly}`,
      `strand=${meta.strand}`
    );
    if (match.genomicStart != null && match.genomicEnd != null) {
      headerParts.push(
        `motif_genomic=${meta.chromosomeAccession}:${match.genomicStart}-${match.genomicEnd}`
      );
    }
  }
  const header = `>${headerParts.join(' | ')}`;
  const wrapped: string[] = [];
  for (let i = 0; i < sequence.length; i += FASTA_WRAP) {
    wrapped.push(sequence.slice(i, i + FASTA_WRAP));
  }
  return [header, ...wrapped].join('\n');
}

/**
 * Build a Primer3Plus-style "SEQUENCE_TARGET=offset,length" hint that some
 * online tools accept for forcing primer pairs to flank a specific feature.
 */
export function buildPrimer3Target(motifOffset: number, motifLength: number): string {
  return `SEQUENCE_TARGET=${motifOffset},${motifLength}`;
}
