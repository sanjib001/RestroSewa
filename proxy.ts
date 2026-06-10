import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function decodeJWT(token: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Always call getUser() — refreshes the session token if expired
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Determine role from JWT claims (populated by custom_access_token_hook)
  let role: string | undefined
  if (user) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) role = decodeJWT(session.access_token).role as string | undefined
  }

  // Protect /operations — restaurant staff only
  if (pathname.startsWith('/operations')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (role !== 'restaurant_admin' && role !== 'restaurant_employee') {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }
  }

  // Protect /super-admin — exclude the login page itself
  if (pathname.startsWith('/super-admin') && pathname !== '/super-admin/login') {
    const isSuperAdmin =
      role === 'super_admin' || user?.app_metadata?.role === 'super_admin'
    if (!user || !isSuperAdmin) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }
  }

  return response
}

export const proxyConfig = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
