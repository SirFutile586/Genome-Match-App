'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPrintHtml, ExportTab } from '@/lib/pdf';

/**
 * Client-rendered print view.
 *
 * The frontend opens this route with one of:
 *   /print?token=<localStorage / sessionStorage key>   (preferred)
 *   /print?data=<URI-encoded JSON>                     (URL fallback)
 *   /print#data=<URI-encoded JSON>                     (hash fallback,
 *     never sent to server; used when local/sessionStorage are blocked)
 *
 * localStorage is shared across same-origin tabs so it works even when the
 * popup is opened with `noopener`. sessionStorage is per-tab and only works
 * for non-noopener popups, so we treat it as a secondary path.
 *
 * After the payload renders, we auto-invoke window.print(); the user picks
 * "Save as PDF" (landscape) in the browser's native dialog. A visible
 * button in the page is the manual fallback.
 */
export default function PrintPage() {
  const [tabs, setTabs] = useState<ExportTab[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printedRef = useRef(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // React StrictMode runs effects twice in dev; we must only consume the
    // payload once so the second run still sees data after we've removed
    // the storage key.
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      const dataParam = url.searchParams.get('data');
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : '';
      const hashParams = new URLSearchParams(hash);
      const hashData = hashParams.get('data');

      let raw: string | null = null;
      if (token) {
        try {
          raw = localStorage.getItem(token);
        } catch {
          // ignored
        }
        if (!raw) {
          try {
            raw = sessionStorage.getItem(token);
          } catch {
            // ignored
          }
        }
        if (!raw) {
          setError(
            'Could not find the export payload. Storage may have been cleared, or your browser is in a mode that does not share storage between tabs. Re-run the search and click Export again.'
          );
          return;
        }
        // Best-effort cleanup so we don't leak the payload forever. This
        // happens AFTER we've captured `raw`, and the loadedRef guard above
        // prevents a second StrictMode pass from seeing a missing key.
        try {
          localStorage.removeItem(token);
        } catch {
          // ignored
        }
        try {
          sessionStorage.removeItem(token);
        } catch {
          // ignored
        }
      } else if (dataParam) {
        raw = decodeURIComponent(dataParam);
      } else if (hashData) {
        raw = decodeURIComponent(hashData);
      }

      if (!raw) {
        setError('No data passed to /print. Open this page from the main app via Export.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) {
        setError('Empty payload — re-run a search and click Export again.');
        return;
      }
      setTabs(parsed as ExportTab[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const html = useMemo(() => (tabs ? buildPrintHtml(tabs) : ''), [tabs]);

  // After the print HTML is in the DOM, kick off the browser's print
  // dialog automatically. We delay one frame so layout settles, and only
  // do it once per mount.
  useEffect(() => {
    if (!tabs || printedRef.current) return;
    printedRef.current = true;
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignored — manual button is still available
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [tabs]);

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }} data-testid="print-error">
        <h1>Could not render print view</h1>
        <p style={{ color: '#b3261e' }}>{error}</p>
        <p>Re-run the search and try Export again.</p>
      </div>
    );
  }
  if (!tabs) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }} data-testid="print-loading">
        <p>Loading print view…</p>
      </div>
    );
  }

  return (
    <div data-testid="print-ready">
      {/* eslint-disable-next-line react/no-danger */}
      <div dangerouslySetInnerHTML={{ __html: extractBody(html) }} />
      {/* Native React click handler — survives even if the inline handler
          inside the dangerouslySetInnerHTML chunk is blocked by a CSP. */}
      <ManualPrintButton />
    </div>
  );
}

function ManualPrintButton() {
  return (
    <button
      data-testid="manual-print"
      className="manual-print-fallback"
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 1000,
        padding: '8px 14px',
        background: '#111',
        color: '#fff',
        border: '1px solid #111',
        borderRadius: 4,
        font: 'inherit',
        cursor: 'pointer',
      }}
      onClick={() => {
        try {
          window.print();
        } catch (e) {
          alert('Could not open the print dialog: ' + (e as Error).message);
        }
      }}
    >
      Print / Save as PDF
    </button>
  );
}

function extractBody(html: string): string {
  const styleMatch = html.match(/<style>[\s\S]*?<\/style>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const style = styleMatch ? styleMatch[0] : '';
  const body = bodyMatch ? bodyMatch[1] : html;
  // Hide the @media print "manual-print-fallback" button.
  const printHide =
    '<style>@media print { .manual-print-fallback { display: none !important; } }</style>';
  return `${style}${printHide}${body}`;
}
