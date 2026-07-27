/** GET /friends — 好友列表 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import { encryptedJsonResponse } from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const friends = await prisma.friend.findMany({
    where: { userId: claims.sub },
    include: {
      other: { select: { username: true, nickname: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return encryptedJsonResponse(
    ok({
      friends: friends.map((f) => ({
        username: f.other.username,
        nickname: f.other.nickname,
        created_at: Math.floor(f.createdAt.getTime() / 1000),
      })),
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
