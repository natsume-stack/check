/**
 * POST /auth/logout — LokiBox 客户端登出
 * 撤销当前 session
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid timestamp'),
      req
    );
  }

  if (parsed.sessionId) {
    await prisma.session
      .update({
        where: { id: parsed.sessionId },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        // session 不存在或已撤销，忽略
      });
  }

  return encryptedJsonResponse(ok(null, 'Logged out'), req);
}

export const dynamic = 'force-dynamic';
