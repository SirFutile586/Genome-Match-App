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
- **In-app ChIP-qPCR primer design (SYBR Green).** For every motif match
  the app proposes 1–3 candidate primer pairs sized for SYBR-based qPCR
  (defaults: amplicon 100–250 bp, primer 18–24 nt, Tm ≈ 60 °C, GC 40–60%,
  rejected on extreme homopolymers / dinucleotide repeats / 3'-end
  GC-clamp violations). Forward and reverse primers are returned in
  standard 5'→3' order, the reverse already reverse-complemented. Each
  pair lists amplicon size, both primer Tms (salt-adjusted formula), GCs,
  and any heuristic warnings. **These are heuristic candidates only**:
  validate with [Primer-BLAST](https://www.ncbi.nlm.nih.gov/tools/primer-blast/),
  UCSC In-Silico PCR, and a wet-lab gradient before ordering.
- **Sequence viewer** view showing the entire 10 kb window with every
  match `<mark>`-highlighted, formatted as 60 bp lines with position
  labels.
- **Tabbed workflow** — every search opens a new tab; tabs can be closed
  individually.
- **Export PDF** has two modes:
  - **Export current tab.** Opens a single-column landscape report for
    the active gene/motif tab — every match with motif label, position,
    species/source, highlighted context, and primer candidates.
  - **Export all tabs.** Opens a landscape report where each open tab is
    rendered as its own vertical column (up to 4 columns per page);
    long tabs paginate onto additional pages with the column header
    repeated above each new page so context is never lost.
- **Sequence provenance panel** under every result lists assembly,
  chromosome accession, transcript accession + select category (or
  fallback reason), strand, TSS, fetched-at timestamp, and genomic
  interval.
- **Multi-gene panel mode.** Paste a list of gene symbols (one per
  line or comma-separated) and the app fans out the same motif search
  across every gene for both species, opens one tab per gene, and
  builds a cross-gene comparison table summarizing binding-site counts
  and the closest TSS-relative position for each gene/species. Useful
  for asking "which of these candidates actually have a STAT3 motif
  near the promoter?".
- **Binding-site index per gene/species.** For every match the app
  reports its 1-based binding-site number, advisor-friendly relative
  position from the TSS (e.g. `−1234 bp from TSS`), a "general
  position" bucket (e.g. `~−1000 bp`), and the **exact 1-based
  genomic interval** of the motif on the chromosome accession (with
  strand). 0 bp = canonical transcript TSS; the transcript accession
  and select category are surfaced under the table.
- **Online-primer-design target sequence.** Each match has an
  expandable "Target sequence" block that builds a centered FASTA
  package suitable for pasting into Primer-BLAST or Primer3Plus.
  Three centered presets are exposed (50 bp each side ≈ 100 bp total,
  100 bp each side ≈ 200 bp total, 200 bp each side ≈ 400 bp total)
  plus a fully custom left/right setting. Header packs gene, species,
  motif, binding-site index, relative position, exact genomic
  interval, transcript accession, assembly, strand, and motif offset
  inside the target window. Copy buttons cover FASTA, plain sequence,
  and a Primer3 `SEQUENCE_TARGET=offset,length` hint.
- **Configurable amplicon range** for the built-in primer picker.
  Default 100–250 bp (ChIP-qPCR / SYBR Green); user can widen or
  narrow it. Built-in candidates respect the configured range; the
  UI states clearly when fewer than three pairs pass the SYBR-friendly
  filters.

## ChIP-qPCR target-planning workflow

The recommended flow when planning ChIP-qPCR primers across one or
several genes:

1. **Search the motif** for one gene (single-gene field) or for a
   panel (paste gene symbols in the "Multi-gene panel" textarea).
2. **Review the cross-gene comparison** at the top of the page to see
   which genes have hits and roughly where (general −bp position).
3. **Open a tab** and skim the binding-site index list for that gene
   — it shows every site numbered, its relative position from the
   TSS, and exact genomic coordinates.
4. **Pick a binding site** to design primers around. ChIP-qPCR
   convention is to take one fragment per region of interest and
   design one or two primer pairs that flank the binding site.
5. **Use the built-in candidates** for a starting point — they're
   filtered to the configured amplicon window (default 100–250 bp)
   and SYBR-friendly Tm/GC bands. They are explicitly labeled
   *preliminary*.
6. **Validate the design** by copying the per-match centered target
   FASTA into Primer3Plus and Primer-BLAST. Use the offered presets
   (50 / 100 / 200 bp each side) or a fully custom flank pair. The
   FASTA header carries the genomic coordinates so Primer-BLAST can
   check specificity against the right organism.
7. **Run a wet-lab gradient + no-template control** before ordering.

The app does **not** model cytokine-stimulation timepoints, signal
transduction networks, or glycan-pattern prediction yet. Those
features are intentionally out of scope at this stage; they will be
layered on top of the same motif/target-sequence pipeline once the
binding-site planning workflow is solid.

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
    ├── sequence.ts               # motif matcher + context windows + primer attach
    ├── primer.ts                 # ChIP-qPCR / SYBR Green primer pair picker
    ├── ncbi.ts                   # live NCBI Datasets + EFetch pipeline
    ├── fasta.ts                  # FASTA parser
    ├── genbank.ts                # GenBank feature parser
    ├── pipeline.ts               # combines NCBI + matcher per species
    └── pdf.ts                    # builds the print-ready HTML report (single + all-tabs)
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

## ChIP-qPCR / SYBR Green primer design

Defaults applied to every motif match (configurable in `lib/primer.ts`
via the `SYBR_DEFAULTS` constant):

| Parameter | Default |
| --- | --- |
| Amplicon size | **100–250 bp** (target ~175 bp) |
| Primer length | **18–24 nt** |
| Tm (approx.) | **57–63 °C**, target ~60 °C |
| Max ΔTm between forward and reverse | **2.5 °C** |
| GC content | **40–60 %** |
| Inner gap (forward 3' to reverse 5') | ≥ 1 nt |
| Pairs returned per match | up to **3**, scored and de-duplicated |

Heuristic Tm formula: salt-free
`Tm = 64.9 + 41 · (GC – 16.4) / length` for primers ≥ 14 nt, falling
back to `4·GC + 2·AT` for shorter oligos. Forward primers are picked
upstream of the motif on the displayed strand; reverse primers are
picked downstream and returned reverse-complemented in standard
ordering (5'→3' as you would order the oligo). Pairs are rejected when
no candidate satisfies the amplicon-size or Tm-delta windows; the UI
states "No SYBR-friendly primer pairs in 100–250 bp window around this
match" in that case.

**Limitations.** This is an in-app heuristic, not Primer3, and there is
no specificity check against the rest of the genome. Always:

1. Run each candidate pair through
   [Primer-BLAST](https://www.ncbi.nlm.nih.gov/tools/primer-blast/) on
   the matching organism before ordering.
2. Verify amplicon uniqueness with UCSC In-Silico PCR.
3. Run a Tm gradient and a no-template control in the wet lab.

The candidate list is meant to short-circuit the "what would a primer
even look like here?" step, not to replace expert design review.

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
  rps. Multi-gene panel mode caps server-side concurrency at 4
  parallel gene lookups so a 20-gene panel fans out predictably; it
  still benefits from `NCBI_API_KEY`. The app surfaces NCBI errors
  verbatim in the per-species warning banner so you can distinguish
  "gene not found" from "NCBI returned 502."
- **Preliminary primer candidates.** The built-in primer picker is a
  transparent heuristic — no Primer3 binary, no specificity check
  against the genome. Treat the candidate list as a starting point
  and always validate with Primer-BLAST + Primer3Plus + a wet-lab
  gradient. The UI labels candidates as *preliminary*.
- **Coordinate mapping for motif matches.** Genomic coordinates of a
  motif occurrence are computed from the canonical transcript's TSS
  and strand. They are exact to the bp on the displayed assembly but
  inherit the canonical-transcript caveats above. Always cross-check
  with the chosen transcript accession before publishing primer
  designs.
- **Out of scope for now.** Cytokine-timepoint kinetics, signal
  transduction networks (JAK/STAT, MAPK, etc.), and glycan-pattern
  prediction are explicitly not modeled in this version of the app
  and should not be inferred from any output here.

## License

Internal scaffold. Adapt freely for your own deployment.
