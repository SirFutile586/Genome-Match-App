# Genome Match — Promoter Motif Search

A Next.js (App Router) + TypeScript web app for searching gene promoter
windows in **human** and **house mouse** for IUPAC-aware motifs (e.g.
`TTCnnnGAA`). Each gene search opens a tab; tabs can be exported together as
a landscape PDF report.

## Features

- Enter a gene symbol (e.g. `ST3GAL1`) and search both species in one click.
- Models a **0–10,000 bp promoter / upstream window** per species.
  - In this scaffold, **0 bp = transcript 5' end**. The production NCBI
    pipeline is designed to refine this using the selected transcript's
    annotated CDS / 5'-UTR boundaries (see *Biological limitations* below).
- IUPAC nucleotide codes supported for motifs:
  `A C G T U N R Y W S K M B D H V` plus the lowercase `n` placeholder so
  you can type motifs like `TTCnnnGAA` directly.
- Configurable **context bases before / after** each match — UI exposes
  0–110 bp on each side; engine accepts up to 500 if you need more.
- **Quick matches** view showing each hit with flanking context, position,
  species, and a highlighted motif span.
- **Sequence viewer** view showing the entire 0–10,000 bp window with
  every match `<mark>`-highlighted, formatted as 60 bp lines with position
  labels.
- **Tabbed workflow** — every search opens a new tab; tabs can be closed
  individually.
- **Export PDF** opens a print-ready landscape report at `/print` with one
  column per tab; use the browser's *Save as PDF* (landscape) to produce
  the file.

## File tree

```
genome_match/
├── README.md
├── package.json
├── next.config.mjs
├── tsconfig.json
├── next-env.d.ts
├── .gitignore
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── print/
│   │   └── page.tsx              # landscape, multi-column print view
│   └── api/
│       ├── search/route.ts       # POST: gene+motif -> per-species results
│       └── sequence/route.ts     # GET:  single (gene, species) window
├── components/
│   ├── SearchWorkspace.tsx       # tabs, search bar, view toggle, export
│   └── SequenceViewer.tsx        # 60 bp lines with highlighted matches
└── lib/
    ├── iupac.ts                  # IUPAC -> regex
    ├── sequence.ts               # motif matcher + context windows
    ├── ncbi.ts                   # NCBI seam (returns demo sequence today)
    ├── fasta.ts                  # FASTA parser (for future NCBI ZIPs)
    ├── genbank.ts                # GenBank feature parser (for 0 bp logic)
    ├── pipeline.ts               # combines NCBI + matcher per species
    └── pdf.ts                    # builds the print-ready HTML report
```

There is **no `script.py`** — this project is pure TypeScript / Next.js.

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

Try the seeded demo: gene `ST3GAL1`, motif `TTCnnnGAA`, context 50/50.

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # strict TS check (no emit)
```

## Deploy to Vercel

1. Push this folder to a GitHub / GitLab / Bitbucket repo.
2. In [vercel.com/new](https://vercel.com/new), import the repo. Vercel
   auto-detects Next.js — leave the defaults (`next build`, output `.next`).
3. No environment variables are required for the demo path.
4. Click **Deploy**. You get a permanent `*.vercel.app` URL.

Alternative: drag-and-drop the project folder ZIP at
[vercel.com/new/upload](https://vercel.com/new) for a one-shot deploy.

### Why no server-side Puppeteer?

Headless Chrome (Puppeteer / `@sparticuz/chromium`) is heavy on Vercel —
serverless function size and cold-start cost make it fragile. Instead the
**Export PDF** button opens `/print` in a new tab; the page is pre-styled
with `@page { size: A4 landscape }` and a column grid, so the user clicks
*Print → Save as PDF (landscape)* to produce the report. The HTML builder
in `lib/pdf.ts` is reusable: if you later want true server-side PDF, swap
the `/print` page for an API route that pipes `buildPrintHtml(tabs)` into
Puppeteer or a hosted PDF service.

## Biological limitations (read this before production use)

This scaffold is **deployable today** but it is not yet wired to live NCBI
data. Specifically:

- `lib/ncbi.ts::downloadSequence` returns a **deterministic demo sequence**
  keyed on `(gene symbol, species)`. The same query always produces the
  same 10 kb window with planted TATA, CAAT, and `TTCnnnGAA` motifs, so
  you can test the UI immediately without any API keys.
- For real production use, replace `downloadSequence` with:
  1. **Symbol → Gene ID lookup** via the NCBI Datasets v2 REST API
     (`/gene/symbol/{symbol}/taxon/{taxon}`).
  2. **Gene data package download** (`/gene/id/{id}/download`) — the
     response is a ZIP containing transcript / CDS / 5'-UTR FASTA and
     GenBank files. Production code needs **ZIP decompression** (e.g.
     `fflate` in serverless, `unzipper` on long-running hosts) and
     careful streaming if running on Vercel's 4.5 MB response limit.
  3. **Transcript selection** — pick MANE Select (human) / RefSeq Select
     (mouse) when available, else the longest annotated transcript. Make
     this choice visible in the UI so users know which transcript anchors
     their 0 bp.
  4. **0 bp coordinate** — derive from the chosen transcript's CDS /
     5'-UTR annotation rather than assuming the literal 5' end.
  5. **Strand handling** — for genes on the minus strand, the upstream
     window must be reverse-complemented before motif matching.
- The IUPAC engine itself is production-quality and unit-testable; only
  the data acquisition layer is stubbed.

The seams are clearly marked with `TODO(NCBI)` comments in `lib/ncbi.ts`,
`lib/fasta.ts`, and `lib/genbank.ts`. When you swap in the live fetcher,
no other module needs to change — `pipeline.ts` already accepts whatever
`SequencePackage` shape `downloadSequence` returns.

## License

Internal scaffold. Adapt freely for your own deployment.
