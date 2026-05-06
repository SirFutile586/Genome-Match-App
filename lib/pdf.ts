// Build a self-contained, print-ready HTML document for the export workflow.
// The /print route renders this HTML in the browser; the user uses the
// browser's native "Save as PDF" (landscape) to produce the report. This
// avoids shipping Puppeteer/Chromium on Vercel, where serverless function
// size limits and cold-start cost make headless Chrome impractical.
//
// If you want a server-side PDF later, swap this for an API route that runs
// `@sparticuz/chromium` + `puppeteer-core` on a Vercel function with the
// generous memory/timeout settings, OR send `buildPrintHtml` output to a
// hosted PDF service.

import type { SpeciesResult } from './pipeline';

export interface ExportTab {
  id: string;
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  results: SpeciesResult[];
}

export function buildPrintHtml(tabs: ExportTab[]): string {
  const cols = Math.max(1, Math.min(tabs.length, 4));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Genome Match Report</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111;
    background: #fff;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  header {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1px solid #111; padding-bottom: 8px; margin-bottom: 12px;
  }
  header h1 { font-size: 14pt; margin: 0; letter-spacing: 0.02em; }
  header .meta { font-size: 9pt; color: #555; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(${cols}, 1fr); }
  .tab {
    break-inside: avoid;
    border: 1px solid #d6d6d6;
    border-radius: 4px;
    padding: 10px 12px;
  }
  .tab h2 { font-size: 12pt; margin: 0 0 4px; }
  .tab .sub { font-size: 9pt; color: #555; margin-bottom: 8px; }
  .species { margin-top: 10px; }
  .species h3 { font-size: 10.5pt; margin: 0 0 4px; }
  .match {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 9pt;
    background: #fafafa;
    border-left: 3px solid #111;
    padding: 6px 8px;
    margin-bottom: 6px;
    word-break: break-all;
    white-space: pre-wrap;
  }
  .match .pos { display: block; font-family: inherit; color: #555; font-size: 8.5pt; margin-bottom: 2px; }
  mark { background: #ffe58a; padding: 0 1px; }
  .empty { color: #888; font-style: italic; font-size: 9.5pt; }
  .print-actions { margin-bottom: 12px; }
  @media print { .print-actions { display: none; } }
  button {
    font: inherit; padding: 6px 12px; border: 1px solid #111; background: #111;
    color: #fff; border-radius: 3px; cursor: pointer;
  }
</style>
</head>
<body>
  <div class="print-actions">
    <button onclick="window.print()">Print / Save as PDF (landscape)</button>
  </div>
  <header>
    <h1>Genome Match Report</h1>
    <div class="meta">${tabs.length} tab${tabs.length === 1 ? '' : 's'} · generated ${new Date().toISOString()}</div>
  </header>
  <main class="grid">
    ${tabs.map(renderTab).join('')}
  </main>
</body>
</html>`;
}

function renderTab(tab: ExportTab): string {
  return `<section class="tab">
    <h2>${escapeHtml(tab.gene)}</h2>
    <div class="sub">Motif <strong>${escapeHtml(tab.motif)}</strong> · flank ${tab.flankBefore}/${tab.flankAfter} bp</div>
    ${tab.results.map(renderSpecies).join('')}
  </section>`;
}

function renderSpecies(r: SpeciesResult): string {
  if (!r.matches.length) {
    return `<div class="species">
      <h3>${escapeHtml(r.taxon)}</h3>
      <div class="empty">No matches in 0–${r.windowEnd} bp.</div>
    </div>`;
  }
  return `<div class="species">
    <h3>${escapeHtml(r.taxon)} — ${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}</h3>
    ${r.matches.map(m => `<div class="match"><span class="pos">pos ${m.position}–${m.end} (0 bp = transcript 5' end)</span>${escapeHtml(m.contextBefore)}<mark>${escapeHtml(m.matched)}</mark>${escapeHtml(m.contextAfter)}</div>`).join('')}
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
