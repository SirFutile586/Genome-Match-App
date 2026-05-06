# Genome Match — Promoter Motif Search

A Next.js (App Router) + TypeScript web app for searching gene promoter
windows in **human** and **house mouse** for IUPAC-aware motifs (e.g.
`TTCnnnGAA`). Each gene search opens a tab; tabs can be exported together
as a landscape PDF report.

Sequences are fetched **live from NCBI** on every search — there is no
deterministic demo path. A search hits NCBI Datasets v2 to resolve the
gene + canonical transcript, then NCBI EFetch (E-utilities) to retrieve
the 10 kb upstream window from the pinned reference assembly.

## Features

- Enter a gene symbol (e.g. `ST3GAL1`) and search both species in one click.
- **0–10,000 bp upstream of the canonical TSS** per species.
  - 0 bp anchors the canonical RefSeq transcript's TSS (transcript 5' end).
  - Array index 0 sits 1 bp upstream of the TSS; index 9,999 sits 10,000
    bp upstream. Position labels in the UI are reported as bp upstream of
    the TSS.
  - Minus-strand genes are reverse-complemented by NCBI so the displayed
    sequence is in transcript-strand orientation.
- IUPAC nucleotide codes supported for motifs:
  `A C G T U N R Y W S K M B D H V` plus the lowercase `n` placeholder so
  you can type motifs like `TTCnnnGAA` directly.
- Configurable **context bases before / after** each match — UI exposes
  0–110 bp on each side; engine accepts up to 500 if you need more.
- **Quick matches** view showing each hit with flanking context, position,
  bp-upstream coordinate, species, and a highlighted motif span.
- **Sequence viewer** view showing the entire 10 kb window with every
  match `<mark>`-highlighted, formatted as 60 bp lines with position
  labels.
- **Tabbed workflow** — every search opens a new tab; tabs can be closed
  individually.
- **Export PDF** opens a print-ready landscape report at `/print`.
- **Sequence provenance panel** under every result lists assembly,
  chromosome accession, transcript accession + select category (or
  fallback reason), strand, TSS, fetched-at timestamp, and genomic
  interval.

## How real-data lookup works

For each `(gene, species)` pair the server route does:

1. **Resolve transcripts.** GET
   `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/{symbol}/taxon/{taxid}/product_report`
   — returns every annotated transcript, its `select_category`
   (`MANE_SELECT` / `RefSeq_Select` when present), `accession_version`,
   and per-assembly `genomic_locations` with exon-level coordinates.
2. **Pick the canonical transcript** (preference order, with the chosen
   reason exposed in the UI):
   1. **MANE Select** (human; first-class joint NCBI/Ensembl annotation).
   2. **RefSeq Select** (mouse; NCBI's chosen representative when MANE
      isn't available for that lineage).
   3. The **longest curated RefSeq mRNA** (`NM_*`) on the pinned
      assembly.
   4. The **longest predicted RefSeq mRNA** (`XM_*`) on the pinned
      assembly. *Predicted models are version-unstable across annotation
      releases — the UI flags this loudly with `[fallback]`.*
3. **Locate the TSS.** Use the chosen transcript's first exon
   (`order: 1`) on the pinned assembly. For a plus-strand transcript,
   TSS = exon `begin`; for minus strand, TSS = exon `end`.
4. **Slice the upstream window.** GET
   `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`
   with `db=nuccore`, the chromosome accession, and:
   - Plus strand: `seq_start = TSS - 10000`, `seq_stop = TSS - 1`,
     `strand = 1`.
   - Minus strand: `seq_start = TSS + 1`, `seq_stop = TSS + 10000`,
     `strand = 2` (NCBI returns the reverse complement).
   The returned 5'→3' transcript-strand FASTA is then reversed so that
   index 0 of the displayed array sits adjacent to the TSS.
5. **Run the IUPAC matcher** against the returned 10 kb window with the
   configured flank sizes.

## Pinned assemblies

| Species | Default assembly | Default accession |
| --- | --- | --- |
| Human (`taxid 9606`) | **GRCh38** | GCF_000001405.40 |
| Mouse (`taxid 10090`) | **GRCm39** | GCF_000001635.27 |

These are pinned for now but configurable via env vars in case the
biological community moves (e.g. T2T-CHM13 for human):

```
NCBI_HUMAN_ASSEMBLY_NAME=GRCh38
NCBI_HUMAN_ASSEMBLY_ACCESSION=GCF_000001405.40
NCBI_MOUSE_ASSEMBLY_NAME=GRCm39
NCBI_MOUSE_ASSEMBLY_ACCESSION=GCF_000001635.27
```

The lookup matches transcript `genomic_locations` whose `sequence_name`
contains the configured assembly name. If no location on that assembly
exists for any transcript, the request errors out with a clear message.

## NCBI API key (optional)

NCBI E-utilities and Datasets work without an API key, but anonymous
clients are throttled to ~3 requests/second per IP. To raise that to
~10 requests/second, [register a free key](https://www.ncbi.nlm.nih.gov/account/settings/)
and set:

```
NCBI_API_KEY=<your_key>
```

The app passes it via the `api_key` query parameter to E-utilities and
the `api-key` header to Datasets v2. No key is required for development
or low-traffic deployments.

## File tree

```
genome_match/
├── README.md
├── package.json
├── next.config.mjs
├── tsconfig.json
├── next-env.d.ts
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
    ├── ncbi.ts                   # live NCBI Datasets + EFetch pipeline
    ├── fasta.ts                  # FASTA parser
    ├── genbank.ts                # GenBank feature parser
    ├── pipeline.ts               # combines NCBI + matcher per species
    └── pdf.ts                    # builds the print-ready HTML report
```

## Local development

```bash
npm install
npm run dev
# open http://localhost:3000
```

Try gene `ST3GAL1`, motif `TTCnnnGAA`, context 50/50. The first request
for a gene takes a few seconds while NCBI is queried.

```bash
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # strict TS check (no emit)
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in [vercel.com/new](https://vercel.com/new). Vercel
   auto-detects Next.js — leave the defaults (`next build`, output
   `.next`).
3. (Optional) add environment variables under Project → Settings →
   Environment Variables:
   - `NCBI_API_KEY` (recommended for any non-trivial traffic)
   - `NCBI_HUMAN_ASSEMBLY_NAME`, `NCBI_HUMAN_ASSEMBLY_ACCESSION`,
     `NCBI_MOUSE_ASSEMBLY_NAME`, `NCBI_MOUSE_ASSEMBLY_ACCESSION` if
     overriding the pinned defaults.
4. Click **Deploy**. The serverless functions for `/api/search` and
   `/api/sequence` make outbound HTTPS calls to
   `api.ncbi.nlm.nih.gov` and `eutils.ncbi.nlm.nih.gov`, both of which
   are reachable from Vercel's default network.

### Vercel function timing

A single search hits NCBI twice per species (Datasets + EFetch). Most
genes return in 2–6 s end-to-end on a cold function. Vercel Hobby
deploys cap serverless function execution at 10 s, which is plenty for
this workload; if you batch many genes server-side later, raise
`maxDuration` per route or move to Vercel Pro.

### Why no server-side Puppeteer?

Headless Chrome (Puppeteer / `@sparticuz/chromium`) is heavy on Vercel
— serverless function size and cold-start cost make it fragile.
Instead the **Export PDF** button opens `/print` in a new tab; the page
is pre-styled with `@page { size: A4 landscape }` and a column grid, so
the user clicks *Print → Save as PDF (landscape)* to produce the
report. The HTML builder in `lib/pdf.ts` is reusable.

## Caveats and limitations

- **Transcript fallback.** If MANE Select / RefSeq Select isn't
  annotated for a gene on the pinned assembly, the app falls back to
  the longest curated `NM_*` and finally the longest predicted `XM_*`.
  The chosen transcript and any fallback reason are surfaced in the
  sequence-provenance panel of every result. Predicted (`XM_*`)
  coordinates can shift between NCBI annotation releases — verify
  before publishing.
- **Single-TSS assumption.** Genes with multiple alternative TSSs (e.g.
  alternative first exons) only get the canonical transcript's TSS as
  the 0 bp anchor; biologically relevant alternative promoters in
  upstream sequence are not enumerated. The provenance panel shows
  exactly which transcript is being used.
- **Strand handling.** Minus-strand genes are reverse-complemented by
  NCBI EFetch (`strand=2`). The displayed sequence is therefore always
  in transcript-strand 5'→3' orientation, then reversed in-array so
  index 0 is closest to the TSS.
- **Assembly drift.** The defaults (GRCh38 / GRCm39) are pinned in
  `lib/ncbi.ts`. If you point the app at a different assembly via env
  vars, the chromosome accessions resolved through `genomic_locations`
  follow automatically — but make sure your downstream coordinate
  consumers know which assembly they're seeing (it's printed in the
  provenance panel).
- **NCBI throttling and outages.** Each search performs two NCBI
  requests per species. Without an API key you share a 3 rps IP-level
  pool with everyone else on the same egress; with a key you get ~10
  rps. The app surfaces NCBI errors verbatim in the per-species
  warning banner so you can distinguish "gene not found" from "NCBI
  returned 502."

## License

Internal scaffold. Adapt freely for your own deployment.
