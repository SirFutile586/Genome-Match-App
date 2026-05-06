'use client';

import { useCallback, useMemo, useState } from 'react';
import SequenceViewer from './SequenceViewer';
import type { SearchResponse, SpeciesResult } from '@/lib/pipeline';

interface Tab {
  id: string;
  label: string;
  gene: string;
  motif: string;
  flankBefore: number;
  flankAfter: number;
  results: SpeciesResult[];
  warnings: string[];
}

type ViewMode = 'matches' | 'viewer';

const FLANK_MAX = 110;

export default function SearchWorkspace() {
  const [gene, setGene] = useState('ST3GAL1');
  const [motif, setMotif] = useState('TTCnnnGAA');
  const [flankBefore, setFlankBefore] = useState(50);
  const [flankAfter, setFlankAfter] = useState(50);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('matches');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  );

  const onSearch = useCallback(async () => {
    setError(null);
    if (!gene.trim()) return setError('Enter a gene symbol.');
    if (!motif.trim()) return setError('Enter a motif (IUPAC codes allowed).');
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
          species: ['human', 'mouse'],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Search failed (${res.status}).`);
      }
      const data: SearchResponse = await res.json();
      const id = `${data.gene}-${Date.now().toString(36)}`;
      const tab: Tab = {
        id,
        label: `${data.gene} · ${data.motif}`,
        gene: data.gene,
        motif: data.motif,
        flankBefore: data.flankBefore,
        flankAfter: data.flankAfter,
        results: data.results,
        warnings: data.warnings,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveId(id);
      setView('matches');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [gene, motif, flankBefore, flankAfter]);

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

  const exportAll = useCallback(() => {
    if (!tabs.length) return;
    // Snapshot the current tab state and hand it to the print-friendly route.
    const payload = encodeURIComponent(
      JSON.stringify(
        tabs.map((t) => ({
          id: t.id,
          gene: t.gene,
          motif: t.motif,
          flankBefore: t.flankBefore,
          flankAfter: t.flankAfter,
          results: t.results,
        }))
      )
    );
    window.open(`/print?data=${payload}`, '_blank', 'noopener');
  }, [tabs]);

  return (
    <>
      <div className="search-bar">
        <Field label="Gene symbol">
          <input
            value={gene}
            onChange={(e) => setGene(e.target.value)}
            placeholder="e.g. ST3GAL1"
            spellCheck={false}
          />
        </Field>
        <Field label="Motif (IUPAC)">
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="e.g. TTCnnnGAA"
            spellCheck={false}
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
        <button className="btn" onClick={onSearch} disabled={busy}>
          {busy ? 'Searching…' : 'Search + new tab'}
        </button>
        <button
          className="btn secondary"
          onClick={exportAll}
          disabled={!tabs.length}
          title="Open the print view in a new tab and use the browser's Save as PDF in landscape orientation."
        >
          Export PDF
        </button>
      </div>

      {error ? <div className="banner warn" style={{ marginTop: 12 }}>{error}</div> : null}

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
                Quick matches
              </button>
              <button
                className={`subtab ${view === 'viewer' ? 'active' : ''}`}
                onClick={() => setView('viewer')}
              >
                Sequence viewer (0–10,000 bp)
              </button>
            </div>
            <div className="sub" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              Motif <strong style={{ color: 'var(--ink)' }}>{activeTab.motif}</strong> · context{' '}
              {activeTab.flankBefore}/{activeTab.flankAfter} bp
            </div>
          </div>

          {activeTab.warnings.length ? (
            <div className="banner warn">{activeTab.warnings.join(' ')}</div>
          ) : null}

          {view === 'matches' ? (
            <MatchesView results={activeTab.results} />
          ) : (
            <ViewerView results={activeTab.results} motif={activeTab.motif} />
          )}

          <div className="notes">
            <div>
              0 bp = transcript 5' end (this scaffold). Window is 0–10,000 bp upstream.
            </div>
            {activeTab.results[0]?.notes?.length ? (
              <ul>
                {activeTab.results[0].notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <h2>No searches yet</h2>
          <p>Try gene <code>ST3GAL1</code> with motif <code>TTCnnnGAA</code> and 50 bp context. Each search opens a new tab.</p>
        </div>
      )}
    </>
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

function MatchesView({ results }: { results: SpeciesResult[] }) {
  return (
    <>
      {results.map((r) => (
        <section key={r.species} className="species-block">
          <h2>
            {r.taxon}
            <span className="count">
              {r.matches.length} match{r.matches.length === 1 ? '' : 'es'} · source: {r.source}
            </span>
          </h2>
          {r.matches.length === 0 ? (
            <div className="empty-state">No matches in 0–{r.windowEnd} bp.</div>
          ) : (
            r.matches.map((m, i) => (
              <div key={i} className="match-card">
                <div className="meta">
                  position {m.position}–{m.end} · {r.taxon}
                </div>
                <div className="seq">
                  {m.contextBefore}
                  <mark>{m.matched}</mark>
                  {m.contextAfter}
                </div>
              </div>
            ))
          )}
        </section>
      ))}
    </>
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
              0–{r.windowEnd} bp · {r.matches.length} highlighted match
              {r.matches.length === 1 ? '' : 'es'}
            </span>
          </h2>
          <div className="viewer-header">
            <span>
              0 bp anchor: <strong>transcript 5' end</strong> · motif{' '}
              <strong>{motif}</strong>
            </span>
            <span>length: {r.promoterWindow.length} bp</span>
          </div>
          <SequenceViewer
            sequence={r.promoterWindow}
            matches={r.matches.map((m) => [m.position, m.end])}
          />
        </section>
      ))}
    </>
  );
}
