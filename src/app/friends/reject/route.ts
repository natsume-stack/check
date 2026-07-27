/** POST /friends/reject — 拒绝好友请求 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser } from '@/lib/auth';

interface RejectPayload {
  target_username: string;
}

export async function POST(req: NextRequest) {
  const parsed = await parseEncryptedRequest<RejectPayload>(req);
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

  await prisma.friendRequest.deleteMany({
    where: {
      from: { username: targetUsername },
      toId: claims.sub,
    },
  });

  return encryptedJsonResponse(ok({ username: targetUsername }, 'Rejected'), req);
}

export const dynamic = 'force-dynamic';
