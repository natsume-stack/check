/** POST /friends/request — 发送好友请求 */
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

interface RequestPayload {
  target_username: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, { key: 'friends-api', windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return encryptedJsonResponse(
      fail('RATE_LIMITED', 'Too many requests'),
      req
    );
  }

  const parsed = await parseEncryptedRequest<RequestPayload>(req);
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

  const targetUsername = parsed.data?.target_username?.trim();
  if (!targetUsername) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'target_username required'), req);
  }

  const target = await prisma.lokiUser.findUnique({
    where: { username: targetUsername },
  });
  if (!target) {
    return encryptedJsonResponse(fail('TARGET_NOT_FOUND', 'Target user not found'), req);
  }

  if (target.id === claims.sub) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Cannot friend yourself'), req);
  }

  const existing = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId: claims.sub, otherId: target.id },
        { userId: target.id, otherId: claims.sub },
      ],
    },
  });
  if (existing) {
    return encryptedJsonResponse(fail('ALREADY_FRIENDS', 'Already friends'), req);
  }

  const pending = await prisma.friendRequest.findUnique({
    where: {
      fromId_toId: { fromId: claims.sub, toId: target.id },
    },
  });
  if (pending) {
    return encryptedJsonResponse(fail('FRIEND_REQUEST_EXISTS', 'Request already exists'), req);
  }

  await prisma.friendRequest.create({
    data: { fromId: claims.sub, toId: target.id },
  });

  return encryptedJsonResponse(ok({ username: target.username }, 'Request sent'), req);
}

export const dynamic = 'force-dynamic';
