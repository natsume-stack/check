/** POST /friends/request — 发送好友请求 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface RequestPayload {
  target_username: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<RequestPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
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
