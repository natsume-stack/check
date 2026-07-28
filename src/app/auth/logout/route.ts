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
  getClientIp,
} from '@/lib/request';
import { checkRateLimit } from '@/lib/security';
import { getLokiBoxUser } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'auth-logout', windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid timestamp'),
      req
    );
  }

  // 认证校验 — 必须携带有效 JWT，防止未授权的 session 吊销（DoS）
  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  // 只能吊销自己的 session（JWT 中的 sid 必须与请求的 sessionId 一致）
  if (parsed.sessionId && claims.sid === parsed.sessionId) {
    // 先准备加密响应（此时 session 仍有效，用 sessionKey 加密）
    const response = await encryptedJsonResponse(ok(null, 'Logged out'), req);

    // 再吊销 session（响应已准备好，不受影响）
    await prisma.session
      .update({
        where: { id: parsed.sessionId },
        data: { revokedAt: new Date() },
      })
      .catch(() => {
        // session 不存在或已撤销，忽略
      });

    return response;
  }

  return encryptedJsonResponse(ok(null, 'Logged out'), req);
}

export const dynamic = 'force-dynamic';
