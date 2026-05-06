import { NextResponse } from 'next/server';
import { runSearch } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runSearch({
      gene: body.gene,
      motif: body.motif,
      flankBefore: body.flankBefore,
      flankAfter: body.flankAfter,
      species: body.species,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
