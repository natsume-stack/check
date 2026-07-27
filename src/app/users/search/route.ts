/**
 * POST /users/search — 搜索用户
 *   { keyword }
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface SearchPayload {
  keyword: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<SearchPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const kw = parsed.data?.keyword?.trim();
  if (!kw || kw.length < 1) {
    return encryptedJsonResponse(ok({ users: [] }), req);
  }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: kw } },
        { nickname: { contains: kw } },
      ],
      NOT: { id: claims.sub },
    },
    take: 20,
    select: { username: true, nickname: true },
  });

  return encryptedJsonResponse(
    ok({ users }),
    req
  );
}

export const dynamic = 'force-dynamic';
