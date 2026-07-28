/** POST /friends/accept — 接受好友请求 */
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

interface AcceptPayload {
  requester_username: string;
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

  const parsed = await parseEncryptedRequest<AcceptPayload>(req);
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

  const requesterUsername = parsed.data?.requester_username?.trim();
  if (!requesterUsername) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'requester_username required'), req);
  }

  const friendReq = await prisma.friendRequest.findFirst({
    where: {
      from: { username: requesterUsername },
      toId: claims.sub,
    },
    include: { from: true },
  });
  if (!friendReq) {
    return encryptedJsonResponse(fail('NOT_FOUND', 'No such request'), req);
  }

  await prisma.$transaction([
    prisma.friend.create({
      data: { userId: friendReq.fromId, otherId: friendReq.toId },
    }),
    prisma.friend.create({
      data: { userId: friendReq.toId, otherId: friendReq.fromId },
    }),
    prisma.friendRequest.delete({ where: { id: friendReq.id } }),
  ]);

  return encryptedJsonResponse(ok({ username: friendReq.from.username }, 'Accepted'), req);
}

export const dynamic = 'force-dynamic';
