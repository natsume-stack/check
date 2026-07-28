/**
 * GET /pack — 下发完整代码包给加载器
 *
 * 加密链路：Bearer token 鉴权 + sessionKey 加密响应
 * 响应：ok({ code: string, hash: string, version: string })
 *
 * 代码包是完整的 lokibox.pack.js（包含所有 features + UI），
 * 客户端解密后 eval 执行。
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import {
  parseEncryptedRequest,
  encryptedJsonResponse,
} from '@/lib/request';
import { getLokiBoxUser, checkUserStatus } from '@/lib/auth';

const STATUS_FAIL_CODE: Record<string, string> = {
  BANNED: 'ACCOUNT_BANNED',
  EXPIRED: 'ACCOUNT_EXPIRED',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
};

export async function GET(req: NextRequest) {
  const parsed = await parseEncryptedRequest(req);

  if (!parsed.replayValid) {
    return encryptedJsonResponse(
      fail('VALIDATION_ERROR', 'Invalid or expired timestamp'),
      req
    );
  }

  const claims = await getLokiBoxUser(req);
  if (!claims) {
    return encryptedJsonResponse(
      fail('UNAUTHORIZED', 'Not authenticated'),
      req
    );
  }

  // 检查账号状态
  const statusCheck = await checkUserStatus(claims.sub);
  if (!statusCheck.ok) {
    return encryptedJsonResponse(
      fail(
        STATUS_FAIL_CODE[statusCheck.reason] ?? 'ACCOUNT_BANNED',
        statusCheck.message
      ),
      req
    );
  }

  // 查询激活的代码包
  const pack = await prisma.codePackage.findFirst({
    where: {
      featureId: 'lokibox-pack',
      isActive: true,
    },
    select: {
      encryptedCode: true,
      codeHash: true,
      version: true,
    },
  });

  if (!pack) {
    return encryptedJsonResponse(
      fail('PACK_NOT_FOUND', 'Code package not uploaded yet'),
      req
    );
  }

  // 更新 session 的 codeHash（用于心跳完整性校验）
  const sessionId = req.headers.get('X-Session-Id');
  if (sessionId) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { codeHash: pack.codeHash },
    });
  }

  return encryptedJsonResponse(
    ok({
      code: pack.encryptedCode,
      hash: pack.codeHash,
      version: pack.version,
    }),
    req
  );
}

export const dynamic = 'force-dynamic';
