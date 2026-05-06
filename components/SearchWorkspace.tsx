'use client';

import { useCallback, useMemo, useState } from 'react';
import SequenceViewer from './SequenceViewer';
import type { PanelSearchResponse, SearchResponse, SpeciesResult } from '@/lib/pipeline';
import type { MotifMatch } from '@/lib/sequence';
import type { PrimerPair } from '@/lib/primer';
import { buildTargetWindow } from '@/lib/sequence';
import { buildTargetFasta, formatRelPosition, bucketRelPosition, buildPrimer3Target } from '@/lib/format';

interface Tab {
  id: string;
  label: string;
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  ampliconMin: number;
  ampliconMax: number;
  results: SpeciesResult[];
  warnings: string[];
}

type ViewMode = 'matches' | 'viewer';

const FLANK_MAX = 110;
const AMPLICON_MIN_LIMIT = 50;
const AMPLICON_MAX_LIMIT = 1000;

/**
 * Centered target-window presets (left flank + match + right flank). The
 * advisor described two common choices: 200 bp total centered on the motif
 * (≈100 bp each side) and 200 bp on each side (≈400 bp total). We expose
 * both, plus a tighter 50-bp-each-side option and a fully custom mode.
 */
interface FlankPreset {
  id: string;
  label: string;
  left: number;
  right: number;
  /** Brief hint shown under the preset selector. */
  hint: string;
}
const FLANK_PRESETS: FlankPreset[] = [
  {
    id: '100-100',
    label: '~200 bp total · 100 bp each side',
    left: 100,
    right: 100,
    hint: 'Total ≈200 bp centered on the motif. Default for most ChIP-qPCR primer design.',
  },
  {
    id: '50-50',
    label: '~100 bp total · 50 bp each side',
    left: 50,
    right: 50,
    hint: 'Tight 50 bp on each side of the motif when you want a short context window.',
  },
  {
    id: '200-200',
    label: '~400 bp total · 200 bp each side',
    left: 200,
    right: 200,
    hint: '200 bp on each side of the motif — extra room for the primer designer to roam.',
  },
  {
    id: 'custom',
    label: 'Custom left / right (bp)',
    left: 100,
    right: 100,
    hint: 'Set the left and right flank explicitly.',
  },
];

export default function SearchWorkspace() {
  const [gene, setGene] = useState('ST3GAL1');
  const [genesPanel, setGenesPanel] = useState('');
  const [motif, setMotif] = useState('TTCnnnGAA');
  const [flankBefore, setFlankBefore] = useState(50);
  const [flankAfter, setFlankAfter] = useState(50);
  const [ampliconMin, setAmpliconMin] = useState(100);
  const [ampliconMax, setAmpliconMax] = useState(250);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('matches');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'opened' }
    | { kind: 'blocked'; href: string }
    | { kind: 'empty' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  );

  const tabFromSearch = useCallback((data: SearchResponse): Tab => {
    const id = `${data.gene}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    return {
      id,
      label: `${data.gene} · ${data.motif}`,
      gene: data.gene,
      motif: data.motif,
      flankBefore: data.flankBefore,
      flankAfter: data.flankAfter,
      ampliconMin: data.ampliconMin,
      ampliconMax: data.ampliconMax,
      results: data.results,
      warnings: data.warnings,
    };
  }, []);

  const onSearch = useCallback(async () => {
    setError(null);
    if (!gene.trim()) return setError('Enter a gene symbol.');
    if (!motif.trim()) return setError('Enter a motif (IUPAC codes allowed).');
    if (ampliconMax <= ampliconMin) {
      return setError('Amplicon max must be greater than amplicon min.');
    }
    setBusy(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gene,
          motif,
          flankBefore,
          flankAfter,
          ampliconMin,
          ampliconMax,
          species: ['human', 'mouse'],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Search failed (${res.status}).`);
      }
      const data: SearchResponse = await res.json();
      const tab = tabFromSearch(data);
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      setView('matches');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [gene, motif, flankBefore, flankAfter, ampliconMin, ampliconMax, tabFromSearch]);

  const onPanelSearch = useCallback(async () => {
    setError(null);
    const genes = parseGeneList(genesPanel);
    if (!genes.length) return setError('Enter at least one gene symbol in the panel input.');
    if (!motif.trim()) return setError('Enter a motif (IUPAC codes allowed).');
    if (ampliconMax <= ampliconMin) {
      return setError('Amplicon max must be greater than amplicon min.');
    }
    setBusy(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          genes,
          motif,
          flankBefore,
          flankAfter,
          ampliconMin,
          ampliconMax,
          species: ['human', 'mouse'],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Panel search failed (${res.status}).`);
      }
      const panel: PanelSearchResponse = await res.json();
      const newTabs = panel.searches.map((s) => tabFromSearch(s));
      setTabs((prev) => [...prev, ...newTabs]);
      if (newTabs.length) setActiveId(newTabs[newTabs.length - 1].id);
      setView('matches');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [genesPanel, motif, flankBefore, flankAfter, ampliconMin, ampliconMax, tabFromSearch]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id) {
          setActiveId(next.length ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeId]
  );

  const serializeTabs = (subset: Tab[]) =>
    JSON.stringify(
      subset.map((t) => ({
        id: t.id,
        gene: t.gene,
        motif: t.motif,
        flankBefore: t.flankBefore,
        flankAfter: t.flankAfter,
        ampliconMin: t.ampliconMin,
        ampliconMax: t.ampliconMax,
        results: t.results,
      }))
    );

  const openPrint = useCallback((subset: Tab[]) => {
    if (typeof window === 'undefined') return;
    if (!subset.length) {
      setExportStatus({ kind: 'empty' });
      return;
    }
    setExportStatus({ kind: 'starting' });

    const token = `gm-print-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const json = serializeTabs(subset);

    let stored = false;
    try {
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('gm-print-')) continue;
        const parts = key.split('-');
        const ts = parseInt(parts[2] || '', 36);
        if (Number.isFinite(ts) && ts < cutoff) localStorage.removeItem(key);
      }
      localStorage.setItem(token, json);
      stored = true;
    } catch {
      // ignored — try sessionStorage next
    }
    try {
      sessionStorage.setItem(token, json);
      stored = true;
    } catch {
      // ignored
    }

    const printUrl = `/print?token=${encodeURIComponent(token)}`;
    let popup: Window | null = null;
    try {
      popup = window.open(printUrl, '_blank');
    } catch {
      popup = null;
    }

    if (!popup || popup.closed || typeof popup.focus !== 'function') {
      setExportStatus({ kind: 'blocked', href: printUrl });
      if (!stored) {
        try {
          const hashUrl = `/print#data=${encodeURIComponent(json)}`;
          setExportStatus({ kind: 'blocked', href: hashUrl });
        } catch (e) {
          setExportStatus({ kind: 'error', message: (e as Error).message });
        }
      }
      return;
    }
    try {
      popup.focus();
    } catch {
      // some browsers throw on cross-origin focus, ignore
    }
    setExportStatus({ kind: 'opened' });
  }, []);

  const exportAll = useCallback(() => openPrint(tabs), [tabs, openPrint]);
  const exportCurrent = useCallback(() => {
    if (!activeTab) {
      setExportStatus({ kind: 'empty' });
      return;
    }
    openPrint([activeTab]);
  }, [activeTab, openPrint]);

  const dismissExportStatus = useCallback(() => setExportStatus({ kind: 'idle' }), []);

  return (
    <>
      <div className="search-bar">
        <Field label="Gene symbol (single search)">
          <input
            value={gene}
            onChange={(e) => setGene(e.target.value)}
            placeholder="e.g. ST3GAL1"
            spellCheck={false}
            data-testid="single-gene-input"
          />
        </Field>
        <Field label="Motif (IUPAC, applied to every search)">
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="e.g. TTCnnnGAA"
            spellCheck={false}
            data-testid="motif-input"
          />
        </Field>
        <Field label={`Context before (≤${FLANK_MAX} bp)`}>
          <input
            type="number"
            min={0}
            max={FLANK_MAX}
            value={flankBefore}
            onChange={(e) => setFlankBefore(clamp(e.target.valueAsNumber, 0, FLANK_MAX))}
          />
        </Field>
        <Field label={`Context after (≤${FLANK_MAX} bp)`}>
          <input
            type="number"
            min={0}
            max={FLANK_MAX}
            value={flankAfter}
            onChange={(e) => setFlankAfter(clamp(e.target.valueAsNumber, 0, FLANK_MAX))}
          />
        </Field>
        <button className="btn" onClick={onSearch} disabled={busy} data-testid="single-search-btn">
          {busy ? 'Searching…' : 'Search + new tab'}
        </button>
        <div className="export-group">
          <button
            className="btn secondary"
            onClick={exportCurrent}
            disabled={!activeTab}
            title="Print only the active tab. Opens a landscape print view; use the browser's Save as PDF."
          >
            Export current tab
          </button>
          <button
            className="btn secondary"
            onClick={exportAll}
            disabled={!tabs.length}
            title="Print all open tabs as columns. Opens a landscape print view; use the browser's Save as PDF."
          >
            Export all tabs
          </button>
        </div>
      </div>

      <div className="advanced-bar">
        <Field label="Amplicon min (bp)">
          <input
            type="number"
            min={AMPLICON_MIN_LIMIT}
            max={AMPLICON_MAX_LIMIT}
            value={ampliconMin}
            onChange={(e) =>
              setAmpliconMin(clamp(e.target.valueAsNumber, AMPLICON_MIN_LIMIT, AMPLICON_MAX_LIMIT))
            }
            data-testid="amplicon-min-input"
          />
        </Field>
        <Field label="Amplicon max (bp)">
          <input
            type="number"
            min={AMPLICON_MIN_LIMIT}
            max={AMPLICON_MAX_LIMIT}
            value={ampliconMax}
            onChange={(e) =>
              setAmpliconMax(clamp(e.target.valueAsNumber, AMPLICON_MIN_LIMIT, AMPLICON_MAX_LIMIT))
            }
            data-testid="amplicon-max-input"
          />
        </Field>
        <div className="advanced-help">
          <strong>Built-in primer candidates</strong> respect this amplicon range
          (default 100–250 bp for ChIP-qPCR / SYBR Green). Increase the upper
          bound for traditional qPCR fragments or longer ChIP amplicons. Primer
          length 18–24 nt and Tm ≈60 °C remain fixed; export the centered
          target sequence below to design primers in Primer3Plus or
          Primer-BLAST when the built-in heuristic returns &lt;3 candidates.
        </div>
      </div>

      <div className="panel-bar">
        <Field label="Multi-gene panel (one per line or comma-separated)">
          <textarea
            value={genesPanel}
            onChange={(e) => setGenesPanel(e.target.value)}
            placeholder={'e.g.\nSTAT3\nIRF1\nST3GAL1\nMYC'}
            rows={3}
            spellCheck={false}
            data-testid="panel-input"
          />
        </Field>
        <button
          className="btn"
          onClick={onPanelSearch}
          disabled={busy}
          data-testid="panel-search-btn"
        >
          {busy ? 'Searching panel…' : 'Run panel (one tab per gene)'}
        </button>
        <div className="panel-help">
          Runs the same motif search across every gene for human and mouse,
          opens one tab per gene, and produces a comparison summary at the
          top of the results showing per-gene binding-site counts and the
          general −bp position of the closest hit.
        </div>
      </div>

      <MotifHelp />

      {error ? <div className="banner warn" style={{ marginTop: 12 }}>{error}</div> : null}

      <ExportStatusBanner status={exportStatus} onDismiss={dismissExportStatus} />

      <ComparisonPanel tabs={tabs} setActiveId={setActiveId} />

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`tab ${t.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
          >
            <span>{t.label}</span>
            <span
              role="button"
              aria-label={`Close ${t.label}`}
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>

      {activeTab ? (
        <div className="results-shell">
          <div className="toolbar">
            <div className="subtabs">
              <button
                className={`subtab ${view === 'matches' ? 'active' : ''}`}
                onClick={() => setView('matches')}
              >
                Matches &amp; primer design
              </button>
              <button
                className={`subtab ${view === 'viewer' ? 'active' : ''}`}
                onClick={() => setView('viewer')}
              >
                Sequence viewer (0–10,000 bp upstream of TSS)
              </button>
            </div>
            <div className="sub" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              Motif <strong style={{ color: 'var(--ink)' }}>{activeTab.motif}</strong> ·
              context {activeTab.flankBefore}/{activeTab.flankAfter} bp · amplicon{' '}
              {activeTab.ampliconMin}–{activeTab.ampliconMax} bp
            </div>
          </div>

          {activeTab.warnings.length ? (
            <div className="banner warn">{activeTab.warnings.join(' · ')}</div>
          ) : null}

          {view === 'matches' ? (
            <MatchesView tab={activeTab} />
          ) : (
            <ViewerView results={activeTab.results} motif={activeTab.motif} />
          )}

          <SourceMetadata results={activeTab.results} />
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <h2>No searches yet</h2>
          <p>
            Try gene <code>ST3GAL1</code> with motif <code>TTCnnnGAA</code> and the default amplicon
            range. Each search opens a new tab; the panel input above runs the same motif across
            many genes at once for cross-gene comparison.
          </p>
          <p style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 8 }}>
            Sequences are fetched live from NCBI Datasets + EFetch on every search; the first
            request for a gene can take a few seconds.
          </p>
        </div>
      )}
    </>
  );
}

function parseGeneList(input: string): string[] {
  if (!input) return [];
  const parts = input
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function ExportStatusBanner({
  status,
  onDismiss,
}: {
  status:
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'opened' }
    | { kind: 'blocked'; href: string }
    | { kind: 'empty' }
    | { kind: 'error'; message: string };
  onDismiss: () => void;
}) {
  if (status.kind === 'idle') return null;
  if (status.kind === 'starting') {
    return (
      <div className="banner" style={{ marginTop: 12 }} data-testid="export-status">
        Preparing export…
      </div>
    );
  }
  if (status.kind === 'opened') {
    return (
      <div className="banner" style={{ marginTop: 12 }} data-testid="export-status">
        Export view opened in a new tab. Use the button there to print or save as PDF.{' '}
        <button className="btn ghost" style={{ height: 'auto', padding: '0 6px' }} onClick={onDismiss}>
          dismiss
        </button>
      </div>
    );
  }
  if (status.kind === 'empty') {
    return (
      <div className="banner warn" style={{ marginTop: 12 }} data-testid="export-status">
        Nothing to export — run a search first.{' '}
        <button className="btn ghost" style={{ height: 'auto', padding: '0 6px' }} onClick={onDismiss}>
          dismiss
        </button>
      </div>
    );
  }
  if (status.kind === 'blocked') {
    return (
      <div className="banner warn" style={{ marginTop: 12 }} data-testid="export-status">
        Your browser blocked the export pop-up.{' '}
        <a
          href={status.href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="export-fallback-link"
          style={{ color: '#6a4a00', fontWeight: 600, textDecoration: 'underline' }}
        >
          Click here to open the export view
        </a>{' '}
        — your click will count as a user action and bypass the blocker.{' '}
        <button className="btn ghost" style={{ height: 'auto', padding: '0 6px' }} onClick={onDismiss}>
          dismiss
        </button>
      </div>
    );
  }
  return (
    <div className="banner warn" style={{ marginTop: 12 }} data-testid="export-status">
      Export failed: {status.message}.{' '}
      <button className="btn ghost" style={{ height: 'auto', padding: '0 6px' }} onClick={onDismiss}>
        dismiss
      </button>
    </div>
  );
}

function MotifHelp() {
  return (
    <div className="motif-help">
      <strong>What is a motif?</strong> A motif is the DNA pattern (binding
      site / domain) you are searching for in the promoter window — for
      example <code>TTCnnnGAA</code>, where <code>n</code> is any base.
      Each match is a single binding-site candidate; the app numbers matches
      per gene/species and reports the relative position from the TSS in
      advisor-friendly notation (e.g. <code>−1234 bp from TSS</code>) plus
      the exact genomic interval. <strong>Built-in primer candidates are
      preliminary heuristics</strong> — always validate with{' '}
      <a href="https://www.ncbi.nlm.nih.gov/tools/primer-blast/" target="_blank" rel="noopener noreferrer">
        Primer-BLAST
      </a>{' '}
      and{' '}
      <a href="https://www.primer3plus.com/" target="_blank" rel="noopener noreferrer">
        Primer3Plus
      </a>
      , then a wet-lab gradient before ordering. Use the per-match
      <strong> Target sequence (for online primer design)</strong> block to
      copy a centered FASTA to feed the online tools.
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function ComparisonPanel({
  tabs,
  setActiveId,
}: {
  tabs: Tab[];
  setActiveId: (id: string) => void;
}) {
  if (tabs.length < 2) return null;
  // The advisor wanted to see at-a-glance which genes have the motif and
  // which don't. We render a per-gene/species table summarizing match count,
  // the closest position to TSS, and a general -bp bucket.
  return (
    <div className="comparison" data-testid="comparison-panel">
      <div className="comparison-title">
        Cross-gene comparison ({tabs.length} tab{tabs.length === 1 ? '' : 's'})
      </div>
      <div className="comparison-help">
        Quick view of binding-site counts per gene/species at the current
        motif. <em>Closest</em> reports the smallest <code>|bp|</code> from
        TSS; <em>General</em> rounds it for cross-gene comparison.
      </div>
      <div className="comparison-table-wrap">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Gene</th>
              <th>Motif</th>
              <th>Species</th>
              <th>Hits</th>
              <th>Closest to TSS</th>
              <th>General position</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tabs.flatMap((t) =>
              t.results.map((r) => {
                const closest = r.matches.length
                  ? r.matches.reduce((best, m) =>
                      Math.abs(m.relPositionFromTSS) < Math.abs(best.relPositionFromTSS) ? m : best
                    )
                  : null;
                return (
                  <tr key={`${t.id}-${r.species}`}>
                    <td>{t.gene}</td>
                    <td><code>{t.motif}</code></td>
                    <td>{r.taxon}</td>
                    <td className={r.error ? 'cell-warn' : r.matches.length === 0 ? 'cell-zero' : ''}>
                      {r.error ? '—' : r.matches.length}
                      {!r.error && r.matches.length === 0 ? ' (none)' : ''}
                    </td>
                    <td>{closest ? formatRelPosition(closest.relPositionFromTSS) : '—'}</td>
                    <td>{closest ? bucketRelPosition(closest.relPositionFromTSS) : '—'}</td>
                    <td>
                      {r.error
                        ? <span className="cell-warn">{r.error.slice(0, 40)}…</span>
                        : r.meta
                          ? `${r.meta.assembly} · ${r.meta.transcriptAccession}`
                          : '—'}
                    </td>
                    <td>
                      <button className="btn ghost btn-sm" onClick={() => setActiveId(t.id)}>
                        open
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchesView({ tab }: { tab: Tab }) {
  return (
    <>
      {tab.results.map((r) => (
        <section key={r.species} className="species-block">
          <h2>
            {r.taxon}
            <span className="count">
              {r.error
                ? 'lookup failed'
                : `${r.matches.length} binding site${r.matches.length === 1 ? '' : 's'}`}
              {r.meta ? ` · ${r.meta.assembly} · ${r.meta.transcriptAccession}` : ''}
            </span>
          </h2>
          {r.error ? (
            <div className="empty-state">{r.error}</div>
          ) : r.matches.length === 0 ? (
            <div className="empty-state">
              No binding sites in the {r.windowEnd.toLocaleString()} bp upstream window for motif{' '}
              <code>{tab.motif}</code>.
            </div>
          ) : (
            <>
              <BindingSiteIndex matches={r.matches} taxon={r.taxon} />
              {r.matches.map((m) => (
                <MatchCard
                  key={m.index}
                  tab={tab}
                  result={r}
                  match={m}
                />
              ))}
            </>
          )}
        </section>
      ))}
    </>
  );
}

function BindingSiteIndex({ matches, taxon }: { matches: MotifMatch[]; taxon: string }) {
  return (
    <div className="binding-index" data-testid="binding-index">
      <div className="binding-index-title">
        Binding-site locations · {taxon} · {matches.length} site{matches.length === 1 ? '' : 's'}
      </div>
      <ol className="binding-index-list">
        {matches.map((m) => (
          <li key={m.index}>
            <strong>#{m.index}</strong> · {formatRelPosition(m.relPositionFromTSS)} from TSS{' '}
            <span className="muted">
              (general position {bucketRelPosition(m.relPositionFromTSS)})
            </span>
            {m.genomicStart != null && m.genomicEnd != null ? (
              <span className="muted">
                {' '}
                · genomic {m.genomicStart.toLocaleString()}–{m.genomicEnd.toLocaleString()} (
                {m.genomicStrand})
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MatchCard({
  tab,
  result,
  match,
}: {
  tab: Tab;
  result: SpeciesResult;
  match: MotifMatch;
}) {
  return (
    <div className="match-card" data-testid="match-card">
      <div className="meta">
        <strong>Binding site #{match.index}</strong> · {formatRelPosition(match.relPositionFromTSS)}{' '}
        from TSS · {result.taxon}
        {result.meta ? (
          <>
            {' '}
            · transcript <code>{result.meta.transcriptAccession}</code>
            {match.genomicStart != null && match.genomicEnd != null ? (
              <>
                {' '}
                · genomic <code>{result.meta.chromosomeAccession}:
                {match.genomicStart.toLocaleString()}–{match.genomicEnd.toLocaleString()}</code> (
                {match.genomicStrand} strand)
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="seq">
        {match.contextBefore}
        <mark>{match.matched}</mark>
        {match.contextAfter}
      </div>
      <PrimerList primers={match.primers || []} ampliconMin={tab.ampliconMin} ampliconMax={tab.ampliconMax} />
      <TargetSequenceBlock tab={tab} result={result} match={match} />
    </div>
  );
}

function PrimerList({
  primers,
  ampliconMin,
  ampliconMax,
}: {
  primers: PrimerPair[];
  ampliconMin: number;
  ampliconMax: number;
}) {
  if (!primers.length) {
    return (
      <div className="primer-empty">
        No SYBR-friendly primer pairs in {ampliconMin}–{ampliconMax} bp window around this site.
        Use the target sequence below to design primers in Primer3Plus / Primer-BLAST.
      </div>
    );
  }
  const partial = primers.length < 3;
  return (
    <div className="primer-block">
      <div className="primer-title">
        Preliminary primer candidates ({primers.length}/3) · ChIP-qPCR · SYBR Green ·{' '}
        <span className="muted">
          heuristic — validate with Primer-BLAST + Primer3Plus + wet lab
        </span>
      </div>
      <table className="primer-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Forward (5'→3')</th>
            <th>Reverse (5'→3', RC)</th>
            <th>Amplicon</th>
            <th>Tm F / R</th>
            <th>GC F / R</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {primers.map((p, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td><code>{p.forward.sequence}</code></td>
              <td><code>{p.reverse.sequence}</code></td>
              <td>{p.ampliconSize} bp</td>
              <td>{p.forward.tm.toFixed(1)} / {p.reverse.tm.toFixed(1)} °C</td>
              <td>{(p.forward.gc * 100).toFixed(0)}% / {(p.reverse.gc * 100).toFixed(0)}%</td>
              <td className="primer-warn">
                {[...p.warnings, ...p.forward.warnings.map((w) => `F: ${w}`), ...p.reverse.warnings.map((w) => `R: ${w}`)].join('; ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {partial ? (
        <div className="primer-partial">
          Only {primers.length} pair{primers.length === 1 ? '' : 's'} passed the SYBR filters in
          your amplicon window. Loosen the amplicon range or design manually with the target
          sequence below.
        </div>
      ) : null}
    </div>
  );
}

function TargetSequenceBlock({
  tab,
  result,
  match,
}: {
  tab: Tab;
  result: SpeciesResult;
  match: MotifMatch;
}) {
  const [presetId, setPresetId] = useState('100-100');
  const [customLeft, setCustomLeft] = useState(100);
  const [customRight, setCustomRight] = useState(100);
  const preset = FLANK_PRESETS.find((p) => p.id === presetId) || FLANK_PRESETS[0];
  const left = presetId === 'custom' ? customLeft : preset.left;
  const right = presetId === 'custom' ? customRight : preset.right;

  const window = useMemo(
    () => buildTargetWindow(result.promoterWindow, match.position, match.end, left, right),
    [result.promoterWindow, match.position, match.end, left, right]
  );

  const fasta = useMemo(
    () =>
      result.meta
        ? buildTargetFasta({
            gene: tab.gene,
            taxon: result.taxon,
            motifLabel: tab.motif,
            motifIndex: match.index,
            match,
            meta: result.meta,
            sequence: window.sequence,
            leftFlank: window.leftFlank,
            rightFlank: window.rightFlank,
            motifOffset: window.motifOffset,
            motifLength: window.motifLength,
          })
        : '',
    [tab.gene, tab.motif, result.taxon, result.meta, match, window]
  );

  const primer3Hint = buildPrimer3Target(window.motifOffset, window.motifLength);

  return (
    <details className="target-block" data-testid="target-block">
      <summary>
        Target sequence (for online primer design) — {window.leftFlank} bp left + {window.motifLength} bp
        motif + {window.rightFlank} bp right ={' '}
        <strong>{window.sequence.length} bp total</strong>
      </summary>
      <div className="target-controls">
        <Field label="Centered window preset">
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            data-testid="target-preset-select"
          >
            {FLANK_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        {presetId === 'custom' ? (
          <>
            <Field label="Left flank (bp before motif)">
              <input
                type="number"
                min={0}
                max={5000}
                value={customLeft}
                onChange={(e) => setCustomLeft(clamp(e.target.valueAsNumber, 0, 5000))}
              />
            </Field>
            <Field label="Right flank (bp after motif)">
              <input
                type="number"
                min={0}
                max={5000}
                value={customRight}
                onChange={(e) => setCustomRight(clamp(e.target.valueAsNumber, 0, 5000))}
              />
            </Field>
          </>
        ) : null}
        <div className="target-hint">{preset.hint}</div>
      </div>

      <div className="target-grid">
        <div className="target-col">
          <div className="target-label">FASTA (paste into Primer-BLAST / Primer3Plus)</div>
          <textarea
            readOnly
            className="target-fasta"
            value={fasta || window.sequence}
            data-testid="target-fasta"
          />
          <div className="target-actions">
            <CopyButton text={fasta || window.sequence} label="Copy FASTA" testid="copy-fasta" />
            <CopyButton
              text={window.sequence}
              label="Copy plain sequence"
              testid="copy-plain"
            />
            <CopyButton
              text={primer3Hint}
              label="Copy Primer3 SEQUENCE_TARGET"
              testid="copy-target-hint"
            />
          </div>
          <div className="target-meta">
            Motif <code>{match.matched}</code> sits at offset{' '}
            <strong>
              {window.motifOffset}–{window.motifOffset + window.motifLength}
            </strong>{' '}
            inside the target window. Primer3 hint:{' '}
            <code>{primer3Hint}</code>
          </div>
          <div className="target-links">
            <a
              href="https://www.ncbi.nlm.nih.gov/tools/primer-blast/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Primer-BLAST ↗
            </a>{' '}
            ·{' '}
            <a
              href="https://www.primer3plus.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Primer3Plus ↗
            </a>{' '}
            · Always BLAST your final pair for genome-wide specificity.
          </div>
        </div>
      </div>
    </details>
  );
}

function CopyButton({ text, label, testid }: { text: string; label: string; testid?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  const onClick = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback: programmatic textarea + execCommand.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setState('ok');
      setTimeout(() => setState('idle'), 1400);
    } catch {
      setState('err');
      setTimeout(() => setState('idle'), 1800);
    }
  }, [text]);
  return (
    <button
      className="btn secondary btn-sm"
      onClick={onClick}
      data-testid={testid}
      aria-label={label}
    >
      {state === 'ok' ? 'Copied!' : state === 'err' ? 'Copy failed' : label}
    </button>
  );
}

function ViewerView({ results, motif }: { results: SpeciesResult[]; motif: string }) {
  return (
    <>
      {results.map((r) => (
        <section key={r.species} className="species-block">
          <h2>
            {r.taxon}
            <span className="count">
              {r.error
                ? 'lookup failed'
                : `0–${r.windowEnd.toLocaleString()} bp upstream · ${r.matches.length} highlighted match${
                    r.matches.length === 1 ? '' : 'es'
                  }`}
            </span>
          </h2>
          {r.error ? (
            <div className="empty-state">{r.error}</div>
          ) : (
            <>
              <div className="viewer-header">
                <span>
                  0 bp anchor: <strong>TSS of {r.meta?.transcriptAccession || 'canonical transcript'}</strong>
                  {' · '}motif <strong>{motif}</strong>
                </span>
                <span>length: {r.promoterWindow.length.toLocaleString()} bp</span>
              </div>
              <SequenceViewer
                sequence={r.promoterWindow}
                matches={r.matches.map((m) => [m.position, m.end])}
              />
            </>
          )}
        </section>
      ))}
    </>
  );
}

function SourceMetadata({ results }: { results: SpeciesResult[] }) {
  const anyMeta = results.some((r) => r.meta);
  if (!anyMeta) return null;
  return (
    <div className="notes">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Sequence provenance &amp; coordinate system</div>
      <ul>
        {results.map((r) =>
          r.meta ? (
            <li key={r.species}>
              <strong>{r.taxon}:</strong> NCBI · {r.meta.assembly} ({r.meta.assemblyAccession}) ·{' '}
              transcript <code>{r.meta.transcriptAccession}</code>
              {r.meta.transcriptSelectCategory ? ` (${r.meta.transcriptSelectCategory})` : ''}
              {r.meta.transcriptIsFallback ? ' [fallback]' : ''} ·{' '}
              <code>
                {r.meta.chromosomeAccession}:{r.meta.upstreamGenomicStart.toLocaleString()}–
                {r.meta.upstreamGenomicEnd.toLocaleString()}
              </code>{' '}
              · {r.meta.strand} strand · TSS @ {r.meta.tss.toLocaleString()} · fetched{' '}
              {new Date(r.meta.fetchedAt).toUTCString()}
              {r.meta.fallbackReason ? (
                <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 2 }}>
                  ⚠ {r.meta.fallbackReason}
                </div>
              ) : null}
            </li>
          ) : null
        )}
      </ul>
      <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 6 }}>
        <strong>Zero reference:</strong> 0 bp = TSS (transcript 5' end of the canonical RefSeq /
        MANE Select transcript shown above). Negative numbers (e.g. −1234 bp) are upstream of the
        TSS. Genomic coordinates are 1-based on the chromosome accession; for minus-strand genes
        the displayed promoter is reverse-complemented by NCBI EFetch so the same negative-bp
        notation works in both orientations. Always verify the chosen transcript is appropriate
        for your biological question — alternative TSSs may exist.
      </div>
    </div>
  );
}
