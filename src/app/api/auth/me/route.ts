import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAdminClaims } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const claims = await getAdminClaims(req);
  if (!claims) return NextResponse.json({ user: null }, { status: 200 });

  const user = await prisma.adminUser.findUnique({
    where: { id: claims.sub },
    select: { id: true, username: true, nickname: true, role: true },
  });

  return NextResponse.json({ user });
}

export const dynamic = 'force-dynamic';
