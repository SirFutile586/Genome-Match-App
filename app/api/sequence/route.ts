import { NextResponse } from 'next/server';
import { downloadSequence, Species } from '@/lib/ncbi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sequence?gene=ST3GAL1&species=human
 * Returns the 0–10,000 bp promoter window for one (gene, species) pair.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const gene = url.searchParams.get('gene') || '';
    const species = (url.searchParams.get('species') || 'human') as Species;
    if (species !== 'human' && species !== 'mouse') {
      return NextResponse.json({ error: 'species must be "human" or "mouse"' }, { status: 400 });
    }
    const pkg = await downloadSequence(gene, species);
    return NextResponse.json(pkg);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
