import { buildPrintHtml, ExportTab } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { data?: string };
}

/**
 * Server-rendered print view. The frontend opens
 *   /print?data=<URI-encoded JSON of all tabs>
 * and the user uses the browser's "Save as PDF" (landscape) action to produce
 * the report. This is the Vercel-friendly alternative to running Puppeteer
 * inside a serverless function.
 */
export default function PrintPage({ searchParams }: Props) {
  let tabs: ExportTab[] = [];
  let parseError: string | null = null;

  if (searchParams?.data) {
    try {
      const parsed = JSON.parse(decodeURIComponent(searchParams.data));
      if (Array.isArray(parsed)) tabs = parsed;
    } catch (e) {
      parseError = (e as Error).message;
    }
  }

  if (parseError) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Could not render print view</h1>
        <p style={{ color: '#b3261e' }}>{parseError}</p>
        <p>Re-run the search and try Export PDF again.</p>
      </div>
    );
  }

  if (!tabs.length) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Nothing to print</h1>
        <p>Open this page from the Export PDF button in the main app.</p>
      </div>
    );
  }

  const html = buildPrintHtml(tabs);
  // We render the full document body via dangerouslySetInnerHTML on a
  // wrapping <div> so that <style> tags and the @page rule reach the browser
  // exactly as authored — Next's outer html/body wrappers do not interfere
  // with the inner @page directive.
  return (
    <div
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: extractBody(html) }}
    />
  );
}

/** Strip outer <html>/<head>/<body> so we can reuse the shared HTML builder. */
function extractBody(html: string): string {
  // Pull the <style> block + <body> contents.
  const styleMatch = html.match(/<style>[\s\S]*?<\/style>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  const style = styleMatch ? styleMatch[0] : '';
  const body = bodyMatch ? bodyMatch[1] : html;
  return `${style}${body}`;
}
