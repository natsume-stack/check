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
  getClientIp,
} from '@/lib/request';
import { getLokiBoxUser, validateFingerprint, checkUserStatus } from '@/lib/auth';
import { checkRateLimit } from '@/lib/security';

const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

interface SearchPayload {
  keyword: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'user-search', windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<SearchPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
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

  const kw = parsed.data?.keyword?.trim();
  if (!kw || kw.length < 1) {
    return encryptedJsonResponse(ok({ users: [] }), req);
  }

  const users = await prisma.lokiUser.findMany({
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
