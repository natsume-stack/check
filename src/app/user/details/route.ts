/**
 * GET /user/details — 用户详情
 * POST /user/nickname — 更新昵称
 * POST /user/avatar — 更新头像
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const parsed = await parseEncryptedRequest(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid timestamp'),
      req
    );
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
  }

  const user = await prisma.lokiUser.findUnique({
    where: { id: claims.sub },
    select: { username: true, nickname: true },
  });

  if (!user) {
    return encryptedJsonResponse(fail('NOT_FOUND', 'User not found'), req);
  }

  return encryptedJsonResponse(
    ok({ username: user.username, nickname: user.nickname }),
    req
  );
}

export const dynamic = 'force-dynamic';
