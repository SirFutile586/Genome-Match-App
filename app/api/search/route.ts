import { NextResponse } from 'next/server';
import { runSearch, runPanelSearch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body.genes) && body.genes.length) {
      const result = await runPanelSearch({
        genes: body.genes,
        motif: body.motif,
        flankBefore: body.flankBefore,
        flankAfter: body.flankAfter,
        species: body.species,
        ampliconMin: body.ampliconMin,
        ampliconMax: body.ampliconMax,
      });
      return NextResponse.json(result);
    }
    const result = await runSearch({
      gene: body.gene,
      motif: body.motif,
      flankBefore: body.flankBefore,
      flankAfter: body.flankAfter,
      species: body.species,
      ampliconMin: body.ampliconMin,
      ampliconMax: body.ampliconMax,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
