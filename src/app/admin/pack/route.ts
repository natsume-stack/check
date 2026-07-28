/**
 * POST /admin/pack — 管理员上传代码包
 *
 * 请求体：text/plain（代码包 JS 源码）
 * 响应：ok({ id, codeHash, sizeBytes, version })
 *
 * 鉴权：Bearer admin token（JWT with role=SUPER_ADMIN）
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/crypto';
import { requireLokiBoxSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { createHash, createHmac } from 'node:crypto';

const FEATURE_ID = 'lokibox-pack';

export async function POST(req: NextRequest) {
  // 鉴权：需要超级管理员权限（admin Bearer token）
  const claims = await requireLokiBoxSuperAdmin(req);
  if (!claims) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // 读取代码包内容
  const code = await req.text();
  if (!code || code.length < 100) {
    return jsonResponse({ error: 'Invalid pack content' }, 400);
  }

  // 计算 hash、HMAC 签名和大小
  const codeHash = createHash('sha256').update(code).digest('hex');
  const hmacSignature = createHmac(
    'sha256',
    process.env.HMAC_SECRET ?? 'default-hmac-secret-change-me'
  )
    .update(code, 'utf8')
    .digest('hex');
  const sizeBytes = Buffer.byteLength(code, 'utf-8');
  const version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 将旧版本设为 isActive=false
  await prisma.codePackage.updateMany({
    where: { featureId: FEATURE_ID, isActive: true },
    data: { isActive: false },
  });

  // 创建新代码包
  const pack = await prisma.codePackage.create({
    data: {
      featureId: FEATURE_ID,
      version,
      encryptedCode: code,
      codeHash,
      hmacSignature,
      sizeBytes,
      isActive: true,
    },
  });

  // 创建审计日志
  await prisma.auditLog.create({
    data: {
      actorId: claims.sub,
      action: 'UPLOAD_CODE',
      target: FEATURE_ID,
      meta: { version, sizeBytes, codeHash, hmacSignature },
    },
  });

  return jsonResponse(
    ok({
      id: pack.id,
      codeHash,
      hmacSignature,
      sizeBytes,
      version,
    }, 'Pack uploaded')
  );
}

export const dynamic = 'force-dynamic';
