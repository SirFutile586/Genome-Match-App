'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildPrintHtml, ExportTab } from '@/lib/pdf';

/**
 * Client-rendered print view.
 *
 * The frontend opens this route with either:
 *   /print?token=<sessionStorage key>   (preferred — no URL length limit)
 *   /print?data=<URI-encoded JSON>      (fallback when sessionStorage is unavailable)
 *
 * The user uses the browser's native "Save as PDF" (landscape) to produce
 * the report. This replaces the previous server-rendered approach: server
 * rendering broke for large promoter payloads because a multi-tab report
 * with 10 kb windows blew past Vercel's edge URL/searchParam limits and
 * the page would silently render empty. Reading from sessionStorage on the
 * client avoids that limit entirely.
 */
export default function PrintPage() {
  const [tabs, setTabs] = useState<ExportTab[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      const data = url.searchParams.get('data');
      let raw: string | null = null;
      if (token) raw = sessionStorage.getItem(token);
      else if (data) raw = decodeURIComponent(data);
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

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Could not render print view</h1>
        <p style={{ color: '#b3261e' }}>{error}</p>
        <p>Re-run the search and try Export again.</p>
      </div>
    );
  }
  if (!tabs) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <p>Loading print view…</p>
      </div>
    );
  }

  return (
    <div
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: extractBody(html) }}
    />
  );
}

function extractBody(html: string): string {
  const styleMatch = html.match(/<style>[\s\S]*?<\/style>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const style = styleMatch ? styleMatch[0] : '';
  const body = bodyMatch ? bodyMatch[1] : html;
  return `${style}${body}`;
}
