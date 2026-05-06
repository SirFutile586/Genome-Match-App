// Build a self-contained, print-ready HTML document for the export workflow.
//
// The /print client route renders this HTML in the browser; the user uses
// the browser's native "Save as PDF" (landscape) to produce the report.
// We avoid shipping Puppeteer/Chromium on Vercel because serverless
// function size limits and cold-start cost make headless Chrome impractical.
//
// Layout strategy for "all tabs export":
//   * Up to 4 tabs per page side-by-side in a CSS grid (landscape A4 fits
//     this comfortably at 10 pt).
//   * Each tab is a vertical column titled with the gene + motif at the
//     top of every page that contains it. If a tab's content overflows,
//     it continues onto a new page in the same column position via CSS
//     `break-before: page` separators between page groups, so the column
//     header is re-rendered.
//   * Within each column the matches stack one below another. For each
//     match we show:
//       - domain/motif searched (just above the context sequence)
//       - position (bp upstream of TSS) and species/source provenance
//       - the context sequence with the matched motif highlighted
//       - up to 3 candidate ChIP-qPCR primer pairs in a compact form
//
// For "single tab export" we render a single full-width column that lays
// matches out one below another and lets the printer paginate naturally.

import type { SpeciesResult } from './pipeline';
import type { MotifMatch } from './sequence';
import type { PrimerPair } from './primer';

export interface ExportTab {
  id: string;
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  results: SpeciesResult[];
}

const TABS_PER_PAGE = 4;
const MATCHES_PER_PAGE_PER_COLUMN = 6; // approx; used to chunk content into pages so the column header re-prints

export function buildPrintHtml(tabs: ExportTab[]): string {
  const isSingle = tabs.length === 1;
  const css = baseCss();

  if (isSingle) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Genome Match Report — ${escapeHtml(tabs[0].gene)}</title>
<style>${css}</style>
</head>
<body>
  <div class="print-actions">
    <button onclick="window.print()">Print / Save as PDF (landscape)</button>
  </div>
  <header class="report-header">
    <h1>Genome Match Report</h1>
    <div class="meta">single-tab export · generated ${new Date().toISOString()}</div>
  </header>
  ${renderSingleTab(tabs[0])}
</body>
</html>`;
  }

  // All-tabs export: paginate tabs in groups of up to TABS_PER_PAGE, each
  // group a landscape page that holds those tabs as side-by-side columns.
  // For long tabs we chunk matches into pages so the column header reprints.
  const tabPages = tabs.map((t) => paginateTab(t));
  const numColumnPages = Math.max(1, ...tabPages.map((p) => p.length));

  const groups: string[] = [];
  for (let g = 0; g < tabs.length; g += TABS_PER_PAGE) {
    const chunk = tabs.slice(g, g + TABS_PER_PAGE);
    const chunkPages = chunk.map((t) => paginateTab(t));
    const pages = Math.max(1, ...chunkPages.map((p) => p.length));
    for (let pi = 0; pi < pages; pi++) {
      const cols = chunk.length;
      groups.push(
        `<section class="page-grid cols-${cols}">${chunkPages
          .map((pp, idx) => renderColumn(chunk[idx], pp[pi] || []))
          .join('')}</section>`
      );
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Genome Match Report</title>
<style>${css}</style>
</head>
<body>
  <div class="print-actions">
    <button onclick="window.print()">Print / Save as PDF (landscape)</button>
    <span class="hint">${tabs.length} tab${tabs.length === 1 ? '' : 's'} · ${numColumnPages} page-row${numColumnPages === 1 ? '' : 's'} per tab column</span>
  </div>
  <header class="report-header">
    <h1>Genome Match Report</h1>
    <div class="meta">${tabs.length} tab${tabs.length === 1 ? '' : 's'} · generated ${new Date().toISOString()}</div>
  </header>
  ${groups.join('\n')}
</body>
</html>`;
}

interface FlatMatch {
  speciesIdx: number;
  matchIdx: number;
  result: SpeciesResult;
  match: MotifMatch;
}

function flattenTabMatches(tab: ExportTab): FlatMatch[] {
  const out: FlatMatch[] = [];
  tab.results.forEach((r, si) => {
    r.matches.forEach((m, mi) => {
      out.push({ speciesIdx: si, matchIdx: mi, result: r, match: m });
    });
  });
  return out;
}

/**
 * Split a tab's flat match list into chunks that fit one printed page each.
 * Empty species are still represented (an "empty" page entry) so the column
 * header continues to render if the user wants to see that the tab returned
 * zero hits for a species.
 */
function paginateTab(tab: ExportTab): FlatMatch[][] {
  const flat = flattenTabMatches(tab);
  if (!flat.length) return [[]]; // one page with empty content
  const pages: FlatMatch[][] = [];
  for (let i = 0; i < flat.length; i += MATCHES_PER_PAGE_PER_COLUMN) {
    pages.push(flat.slice(i, i + MATCHES_PER_PAGE_PER_COLUMN));
  }
  return pages;
}

function renderColumn(tab: ExportTab, matches: FlatMatch[]): string {
  const speciesSummary = tab.results
    .map((r) =>
      r.error
        ? `${escapeHtml(r.taxon)}: lookup failed`
        : `${escapeHtml(r.taxon)} ${r.matches.length}/${r.windowEnd.toLocaleString()}bp`
    )
    .join(' · ');
  return `<article class="col">
    <header class="col-header">
      <div class="col-title">${escapeHtml(tab.gene)}</div>
      <div class="col-sub">motif <code>${escapeHtml(tab.motif)}</code></div>
      <div class="col-sub muted">${speciesSummary}</div>
    </header>
    <div class="col-body">
      ${matches.length ? matches.map((fm) => renderFlatMatch(fm, tab.motif)).join('') : `<div class="empty">No matches in 0–${(tab.results[0]?.windowEnd || 10000).toLocaleString()} bp window.</div>`}
    </div>
  </article>`;
}

function renderFlatMatch(fm: FlatMatch, motif: string): string {
  const r = fm.result;
  const m = fm.match;
  const meta = r.meta
    ? `${escapeHtml(r.meta.assembly)} · ${escapeHtml(r.meta.chromosomeAccession)}:${r.meta.upstreamGenomicStart}-${r.meta.upstreamGenomicEnd} · ${escapeHtml(r.meta.strand)}`
    : '';
  return `<div class="match">
    <div class="match-motif">domain/motif: <code>${escapeHtml(motif)}</code></div>
    <div class="match-meta">${escapeHtml(r.taxon)} · pos ${m.position}–${m.end} (${m.position + 1} bp upstream of TSS)${meta ? ` · ${meta}` : ''}</div>
    <div class="match-seq">${escapeHtml(m.contextBefore)}<mark>${escapeHtml(m.matched)}</mark>${escapeHtml(m.contextAfter)}</div>
    ${renderPrimers(m.primers || [])}
  </div>`;
}

function renderPrimers(primers: PrimerPair[]): string {
  if (!primers.length) {
    return `<div class="primer-empty">No SYBR-friendly primer pairs found.</div>`;
  }
  return `<table class="primer">
    <thead><tr><th>#</th><th>Fwd 5'→3'</th><th>Rev 5'→3' (RC)</th><th>bp</th><th>Tm F/R</th><th>GC F/R</th></tr></thead>
    <tbody>
      ${primers
        .map(
          (p, i) => `<tr>
        <td>${i + 1}</td>
        <td><code>${escapeHtml(p.forward.sequence)}</code></td>
        <td><code>${escapeHtml(p.reverse.sequence)}</code></td>
        <td>${p.ampliconSize}</td>
        <td>${p.forward.tm.toFixed(1)}/${p.reverse.tm.toFixed(1)}</td>
        <td>${(p.forward.gc * 100).toFixed(0)}/${(p.reverse.gc * 100).toFixed(0)}%</td>
      </tr>${(p.warnings.length || p.forward.warnings.length || p.reverse.warnings.length) ? `<tr class="warn-row"><td></td><td colspan="5">${escapeHtml([...p.warnings, ...p.forward.warnings.map((w) => `F: ${w}`), ...p.reverse.warnings.map((w) => `R: ${w}`)].join('; '))}</td></tr>` : ''}`
        )
        .join('')}
    </tbody>
  </table>`;
}

function renderSingleTab(tab: ExportTab): string {
  const speciesSummary = tab.results
    .map((r) =>
      r.error
        ? `${escapeHtml(r.taxon)}: lookup failed`
        : `${escapeHtml(r.taxon)} ${r.matches.length}/${r.windowEnd.toLocaleString()}bp`
    )
    .join(' · ');
  return `<section class="single">
    <header class="single-header">
      <div class="single-title">${escapeHtml(tab.gene)}</div>
      <div class="single-sub">motif <code>${escapeHtml(tab.motif)}</code> · context ${tab.flankBefore}/${tab.flankAfter} bp</div>
      <div class="single-sub muted">${speciesSummary}</div>
    </header>
    ${tab.results.map((r) => renderSingleSpecies(tab, r)).join('')}
  </section>`;
}

function renderSingleSpecies(tab: ExportTab, r: SpeciesResult): string {
  const provenance = r.meta
    ? `<div class="prov">NCBI · ${escapeHtml(r.meta.assembly)} (${escapeHtml(
        r.meta.assemblyAccession
      )}) · transcript ${escapeHtml(r.meta.transcriptAccession)}${
        r.meta.transcriptSelectCategory ? ` (${escapeHtml(r.meta.transcriptSelectCategory)})` : ''
      }${r.meta.transcriptIsFallback ? ' [fallback]' : ''} · ${escapeHtml(
        r.meta.chromosomeAccession
      )}:${r.meta.upstreamGenomicStart}-${r.meta.upstreamGenomicEnd} · ${escapeHtml(
        r.meta.strand
      )} strand · TSS @ ${r.meta.tss}</div>`
    : '';
  if (r.error) {
    return `<div class="species">
      <h3>${escapeHtml(r.taxon)}</h3>
      <div class="empty">Lookup failed: ${escapeHtml(r.error)}</div>
    </div>`;
  }
  if (!r.matches.length) {
    return `<div class="species">
      <h3>${escapeHtml(r.taxon)}</h3>
      ${provenance}
      <div class="empty">No matches in the ${r.windowEnd.toLocaleString()} bp upstream window.</div>
    </div>`;
  }
  return `<div class="species">
    <h3>${escapeHtml(r.taxon)} — ${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}</h3>
    ${provenance}
    ${r.matches
      .map(
        (m) => `<div class="match wide">
      <div class="match-motif">domain/motif: <code>${escapeHtml(tab.motif)}</code></div>
      <div class="match-meta">pos ${m.position}–${m.end} (${m.position + 1} bp upstream of TSS) · ${escapeHtml(r.taxon)}</div>
      <div class="match-seq">${escapeHtml(m.contextBefore)}<mark>${escapeHtml(m.matched)}</mark>${escapeHtml(m.contextAfter)}</div>
      ${renderPrimers(m.primers || [])}
    </div>`
      )
      .join('')}
  </div>`;
}

function baseCss(): string {
  return `
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111;
    background: #fff;
    font-size: 9.5pt;
    line-height: 1.4;
  }
  .print-actions {
    padding: 8px 12px;
    border-bottom: 1px solid #ccc;
    background: #fafafa;
    display: flex; gap: 12px; align-items: center;
  }
  .print-actions .hint { font-size: 9pt; color: #666; }
  .print-actions button {
    font: inherit; padding: 6px 14px; border: 1px solid #111; background: #111;
    color: #fff; border-radius: 3px; cursor: pointer;
  }
  @media print { .print-actions { display: none; } }

  .report-header {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid #111; padding: 6px 12px; margin: 0;
  }
  .report-header h1 { font-size: 12pt; margin: 0; letter-spacing: 0.02em; }
  .report-header .meta { font-size: 8.5pt; color: #555; }

  /* Multi-tab page grid: each section is a single landscape page. */
  .page-grid {
    display: grid;
    gap: 8px;
    padding: 6px 8px 0;
    page-break-after: always;
    break-after: page;
    grid-template-columns: repeat(var(--cols, 4), 1fr);
  }
  .page-grid:last-child { page-break-after: auto; break-after: auto; }
  .page-grid.cols-1 { --cols: 1; grid-template-columns: 1fr; }
  .page-grid.cols-2 { --cols: 2; grid-template-columns: 1fr 1fr; }
  .page-grid.cols-3 { --cols: 3; grid-template-columns: repeat(3, 1fr); }
  .page-grid.cols-4 { --cols: 4; grid-template-columns: repeat(4, 1fr); }

  .col {
    border: 1px solid #d6d6d6;
    border-radius: 3px;
    padding: 6px 8px;
    overflow: hidden;
    break-inside: avoid;
  }
  .col-header {
    border-bottom: 1px solid #ddd;
    margin-bottom: 6px;
    padding-bottom: 4px;
  }
  .col-title { font-size: 11pt; font-weight: 700; }
  .col-sub { font-size: 8.5pt; color: #333; }
  .col-sub.muted { color: #777; font-size: 8pt; }
  .col-body { display: flex; flex-direction: column; gap: 6px; }

  .match, .match.wide {
    background: #fafafa;
    border-left: 3px solid #111;
    padding: 5px 7px;
    border-radius: 0 3px 3px 0;
  }
  .match-motif {
    font-size: 8pt;
    color: #333;
    margin-bottom: 1px;
  }
  .match-motif code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 8pt;
  }
  .match-meta {
    font-size: 7.5pt;
    color: #666;
    margin-bottom: 3px;
  }
  .match-seq {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 7.5pt;
    word-break: break-all;
    white-space: pre-wrap;
    margin-bottom: 4px;
  }
  .match.wide .match-seq { font-size: 8.5pt; }
  mark {
    background: #ffe066;
    color: #b04a00;
    font-weight: 700;
    padding: 0 1px;
    border-radius: 1px;
  }

  .primer {
    width: 100%;
    border-collapse: collapse;
    font-size: 7pt;
    margin-top: 2px;
  }
  .match.wide .primer { font-size: 8pt; }
  .primer th, .primer td {
    border: 1px solid #ddd;
    padding: 1px 3px;
    text-align: left;
    vertical-align: top;
  }
  .primer th { background: #f0f0ec; font-weight: 600; }
  .primer code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 7pt;
    word-break: break-all;
  }
  .match.wide .primer code { font-size: 8pt; }
  .primer .warn-row td {
    background: #fff5d8;
    color: #6a4a00;
    font-style: italic;
    border-top: none;
  }
  .primer-empty {
    font-size: 7.5pt;
    color: #888;
    font-style: italic;
    margin-top: 2px;
  }

  /* Single-tab export */
  .single {
    padding: 8px 14px;
  }
  .single-header {
    margin-bottom: 8px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
  }
  .single-title { font-size: 14pt; font-weight: 700; }
  .single-sub { font-size: 9.5pt; color: #333; }
  .single-sub.muted { color: #777; font-size: 9pt; }
  .species { margin-top: 12px; break-inside: avoid; }
  .species h3 { font-size: 10.5pt; margin: 0 0 4px; }
  .prov { font-size: 8pt; color: #555; margin-bottom: 4px; word-break: break-all; }
  .empty { color: #888; font-style: italic; font-size: 9pt; padding: 4px 0; }
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
