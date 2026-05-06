import SearchWorkspace from '@/components/SearchWorkspace';

export default function HomePage() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">GM</div>
          <div>
            <h1>Genome Match</h1>
            <div className="sub">Promoter motif search across human and house mouse · 0–10,000 bp upstream</div>
          </div>
        </div>
        <div className="sub">v1.0 · Vercel-ready</div>
      </header>
      <main className="main">
        <SearchWorkspace />
      </main>
    </div>
  );
}
