/** GET /friends/requests — 收到的好友请求列表 */
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

  const requests = await prisma.friendRequest.findMany({
    where: { toId: claims.sub },
    include: {
      from: { select: { username: true, nickname: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return encryptedJsonResponse(
    ok({
      requests: requests.map((r) => ({
        username: r.from.username,
        nickname: r.from.nickname,
        created_at: Math.floor(r.createdAt.getTime() / 1000),
      })),
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
