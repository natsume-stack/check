/**
 * GET /auth/user — 获取当前登录用户信息（LokiBox 用）
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser as getClaims } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const parsed = await parseEncryptedRequest(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid timestamp'),
      req
    );
  }

  const claims = await getClaims(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { username: true, nickname: true, avatarUrl: true },
  });

  if (!user) {
    return encryptedJsonResponse(
      fail('NOT_FOUND', 'User not found'),
      req
    );
  }

  return encryptedJsonResponse(
    ok({
      username: user.username,
      nickname: user.nickname,
      avatar_url: user.avatarUrl,
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
