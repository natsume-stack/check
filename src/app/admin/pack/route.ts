/**
 * POST /admin/pack — 管理员上传代码包
 *
 * 请求体：text/plain（代码包 JS 源码）
 * 响应：ok({ id, codeHash, sizeBytes, version })
 *
 * 鉴权：Bearer admin token（JWT with role=SUPER_ADMIN）
 * 安全：代码包入库前用 AES-256-GCM 加密，数据库不存明文
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail, encryptCodeAtRest } from '@/lib/crypto';
import { requireLokiBoxSuperAdmin } from '@/lib/auth';
import { jsonResponse } from '@/lib/request';
import { createHash } from 'node:crypto';

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

  // 计算 hash 和大小
  const codeHash = createHash('sha256').update(code).digest('hex');
  const sizeBytes = Buffer.byteLength(code, 'utf-8');
  const version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // AES-256-GCM 加密后入库（数据库不存明文）
  const encryptedCode = encryptCodeAtRest(code);

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
      encryptedCode,
      codeHash,
      hmacSignature: '', // 已废弃，保留字段兼容旧数据
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
      meta: { version, sizeBytes, codeHash },
    },
  });

  return jsonResponse(
    ok({
      id: pack.id,
      codeHash,
      sizeBytes,
      version,
    }, 'Pack uploaded')
  );
}

export const dynamic = 'force-dynamic';
