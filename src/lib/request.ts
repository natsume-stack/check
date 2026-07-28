/**
 * 请求工具 — 提取真实 IP、解析加密请求、统一响应格式
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  decryptPayload,
  encryptPayload,
  getBootstrapKey,
  importSessionKey,
  verifyTimestamp,
} from './crypto';
import { prisma } from './prisma';

// ─── 真实 IP 提取（穿过 Vercel 代理）──────────────

export function getClientIp(req: NextRequest): string {
  const headers = req.headers;
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = headers.get('x-real-ip');
  if (real) return real;
  return '127.0.0.1';
}

// ─── 加密请求解析 ──────────────────────────────────

export interface ParsedEncryptedRequest<T> {
  data: T | null;
  sessionId?: string;
  authToken?: string;
  timestamp: number;
  nonce: string;
  iv?: string;
  rawBody: string;
  replayValid: boolean;
  nonceValid: boolean;
}

/** 解析 LokiBox 兼容的加密请求 */
export async function parseEncryptedRequest<T = unknown>(
  req: NextRequest
): Promise<ParsedEncryptedRequest<T>> {
  const timestamp = Number(req.headers.get('X-TimeStamp') ?? '0');
  const nonce = req.headers.get('X-Nonce') ?? '';
  const iv = req.headers.get('X-IV') ?? undefined;
  const sessionId = req.headers.get('X-Session-Id') ?? undefined;
  const authHeader = req.headers.get('Authorization') ?? '';
  const authToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  const timestampValid = !!timestamp && verifyTimestamp(timestamp);
  const rawBody = await req.text();

  // Nonce 防重放：在时间戳有效的前提下，校验 nonce 是否已被使用
  // 使用 DB unique constraint 原子操作：create 成功 = 首次使用，P2002 = 重放
  let nonceValid = false; // fail-closed：默认拒绝，DB 写入成功才放行
  if (timestampValid && nonce) {
    try {
      await prisma.usedNonce.create({ data: { nonce } });
      nonceValid = true; // create 成功 = 首次使用，放行
    } catch (e: any) {
      if (e?.code === 'P2002') {
        nonceValid = false; // 唯一约束冲突 = 重放攻击
      }
      // 其他 DB 故障也拒绝（fail-closed，防止限流/防重放被绕过）
    }
    // 1% 概率清理过期 nonce（超过 2 分钟）
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - 120_000);
      prisma.usedNonce.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
    }
  }

  // replayValid 统一包含时间戳 + nonce 双重校验
  const replayValid = timestampValid && nonceValid;

  let data: T | null = null;
  if (iv && rawBody && replayValid && nonceValid) {
    let key = await getBootstrapKey();

    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
      });
      if (session && session.expiresAt > new Date() && !session.revokedAt) {
        key = await importSessionKey(session.sessionKey);
      }
    }

    try {
      data = await decryptPayload<T>({ iv, data: rawBody }, key);
    } catch {
      data = null;
    }
  }

  return {
    data,
    sessionId,
    authToken,
    timestamp,
    nonce,
    iv,
    rawBody,
    replayValid,
    nonceValid,
  };
}

// ─── 加密响应 ──────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://view.dao3.fun',
  'https://dao3.fun',
  'https://play.dao3.fun',
  'https://www.dao3.fun',
  'https://check.cdk.lat',
];

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-TimeStamp, X-Nonce, X-IV, X-Session-Id, X-Fingerprint',
      // 关键：暴露 X-Iv 给 JavaScript，否则跨域时 resp.headers.get('X-Iv') 返回 null
      'Access-Control-Expose-Headers': 'X-Iv, X-Session-Id',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }
  return {};
}

/** 用与请求相同的 sessionKey 加密响应体 */
export async function encryptedJsonResponse(
  payload: unknown,
  req: NextRequest
): Promise<NextResponse> {
  const sessionId = req.headers.get('X-Session-Id') ?? undefined;
  const cors = corsHeaders(req);

  // 优先用 sessionKey 加密响应
  // 注意：不能依赖 X-IV 头判断是否有 session，因为 GET 请求无请求体时不会发送 X-IV
  if (sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (session && session.expiresAt > new Date() && !session.revokedAt) {
      const key = await importSessionKey(session.sessionKey);
      const encrypted = await encryptPayload(payload, key);
      return new NextResponse(encrypted.data, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'X-Iv': encrypted.iv,
          ...cors,
        },
      });
    }
  }

  // 否则用 BootstrapKey 加密
  const bsKey = await getBootstrapKey();
  const encrypted = await encryptPayload(payload, bsKey);
  return new NextResponse(encrypted.data, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'X-Iv': encrypted.iv,
      ...cors,
    },
  });
}

// ─── 普通响应（管理后台用）────────────────────────

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
