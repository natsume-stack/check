/**
 * GET /auth/user — 获取当前登录用户信息（LokiBox 用）
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
  getClientIp,
} from '@/lib/request';
import { getLokiBoxUser as getClaims, validateFingerprint, checkUserStatus } from '@/lib/auth';
import { checkRateLimit } from '@/lib/security';

const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'auth-user', windowMs: 60_000, max: 30 });
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

  const claims = await getClaims(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  // 设备指纹验证
  const fpValid = await validateFingerprint(claims.sub, claims.fp);
  if (!fpValid) {
    return encryptedJsonResponse(
      fail('DEVICE_MISMATCH', 'Device fingerprint mismatch, please re-login'),
      req
    );
  }

  // 账号状态检查
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    return encryptedJsonResponse(
      fail(STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED', statusCheck.message),
      req
    );
  }

  const user = await prisma.lokiUser.findUnique({
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
