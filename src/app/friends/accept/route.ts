/** POST /friends/accept — 接受好友请求 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface AcceptPayload {
  requester_username: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<AcceptPayload>(req);
  if (!parsed.replayValid) {
    return encryptedJsonResponse(fail('VALIDATION_ERROR', 'Invalid timestamp'), req);
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(fail('UNAUTHORIZED', 'Not authenticated'), req);
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
