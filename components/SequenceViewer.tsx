'use client';

import { Fragment, useMemo } from 'react';

interface Props {
  sequence: string;
  /** Inclusive start, exclusive end pairs. */
  matches: Array<[number, number]>;
}

/**
 * Renders the full promoter window with motif matches highlighted via <mark>.
 * The sequence is broken into 60 bp lines with a position label on the left,
 * which is the de-facto convention for sequence display in tools like
 * BLAST and Jalview.
 */
export default function SequenceViewer({ sequence, matches }: Props) {
  const segments = useMemo(() => buildSegments(sequence, matches), [sequence, matches]);

  // Group rendered output into 60 bp lines.
  const LINE = 60;
  const lines: Array<{ start: number; nodes: React.ReactNode[] }> = [];
  let currentLine: { start: number; nodes: React.ReactNode[] } = { start: 0, nodes: [] };
  let column = 0;

  segments.forEach((seg, segIdx) => {
    let text = seg.text;
    let offset = seg.start;
    while (text.length > 0) {
      const room = LINE - column;
      const take = text.slice(0, room);
      const node = seg.highlight ? (
        <mark key={`${segIdx}-${offset}`}>{take}</mark>
      ) : (
        <Fragment key={`${segIdx}-${offset}`}>{take}</Fragment>
      );
      currentLine.nodes.push(node);
      column += take.length;
      offset += take.length;
      text = text.slice(take.length);
      if (column >= LINE) {
        lines.push(currentLine);
        currentLine = { start: offset, nodes: [] };
        column = 0;
      }
    }
  });
  if (currentLine.nodes.length) lines.push(currentLine);

  return (
    <div className="viewer" role="region" aria-label="Promoter sequence viewer">
      {lines.map((ln, i) => (
        <div key={i} style={{ display: 'flex', gap: 12 }}>
          <span style={{ color: 'var(--ink-3)', minWidth: 64, textAlign: 'right' }}>
            {ln.start.toString().padStart(6, ' ')}
          </span>
          <span>{ln.nodes}</span>
        </div>
      ))}
    </div>
  );
}

interface Segment { start: number; text: string; highlight: boolean; }

function buildSegments(seq: string, matches: Array<[number, number]>): Segment[] {
  if (!matches.length) return [{ start: 0, text: seq, highlight: false }];
  // Sort and merge overlapping match ranges.
  const sorted = [...matches].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    if (!merged.length || s > merged[merged.length - 1][1]) {
      merged.push([s, e]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    }
  }
  const out: Segment[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (cursor < s) out.push({ start: cursor, text: seq.slice(cursor, s), highlight: false });
    out.push({ start: s, text: seq.slice(s, e), highlight: true });
    cursor = e;
  }
  if (cursor < seq.length) out.push({ start: cursor, text: seq.slice(cursor), highlight: false });
  return out;
}
