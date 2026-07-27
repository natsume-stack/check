import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/', '/login', '/register'];
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/auth/register', '/api/auth/me'];

function getJwtSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s) return new Uint8Array();
  return new TextEncoder().encode(s);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公开路径放行
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // LokiBox 加密 API 放行（自己有鉴权）
  if (
    pathname.startsWith('/session') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/user/') ||
    pathname.startsWith('/presence/') ||
    pathname.startsWith('/friends/') ||
    pathname.startsWith('/users/search')
  ) {
    return NextResponse.next();
  }
  // 静态资源放行
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // 检查管理后台 Cookie
  const token = req.cookies.get('check_session')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] });
    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
