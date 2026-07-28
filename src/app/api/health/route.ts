/**
 * GET /api/health — 保活探针
 *
 * 给 Cloudflare Worker cron 定时调用，防止 Vercel Serverless 冷启动。
 * 不鉴权、不查库，只返回 200 OK，保证响应最快。
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'check',
      ts: Date.now(),
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

export const dynamic = 'force-dynamic';
