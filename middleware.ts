import { NextRequest, NextResponse } from "next/server";
import getAuth from "@/lib/auth/getAuth";
import { homeFor } from "@/lib/helpers/roleHome";
import {
  PRIVATE_ROUTES,
  AUTH_ROUTES,
  VERIFY_EMAIL,
} from "@/lib/constants/routes";

export async function middleware(req: NextRequest) {
  const session = await getAuth();
  const { pathname } = req.nextUrl;

  // Auth routes should not be accessible to authenticated users
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (session) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // /admin is the administrator's own sign-in page, separate from the customers' /auth/login.
  if (pathname === "/admin" || pathname === "/admin/") {
    if (session?.user.role === "ADMIN") {
      return NextResponse.redirect(new URL("/admin/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // Protect private routes
  if (PRIVATE_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!session) {
      if (pathname.startsWith("/admin")) {
        return NextResponse.redirect(new URL("/admin", req.url));
      }
      const callbackUrl = encodeURIComponent(req.nextUrl.pathname);
      return NextResponse.redirect(
        new URL(`/auth/login?callbackUrl=${callbackUrl}`, req.url)
      );
    }

    // Email not verified
    if (!session.user.emailVerifie) {
      return NextResponse.redirect(
        new URL(`${VERIFY_EMAIL}?refresh=true`, req.url)
      );
    }

    // Already verified, shouldn't access verify-email page
    if (pathname === VERIFY_EMAIL && session.user.emailVerifie) {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // Role-based protection
    const role = session.user.role;
    const own = homeFor(role);
    const sendHome = () => NextResponse.redirect(new URL(own, req.url));
    if (pathname.startsWith("/admin") && role !== "ADMIN") {
      return sendHome();
    }
    // The vendor area is switched off: this shop has an owner, customers and delivery staff only.
    if (pathname.startsWith("/vendor") && (process.env.ALLOW_VENDORS !== "true" || role !== "VENDEUR")) {
      return sendHome();
    }
    if (pathname.startsWith("/client") && role !== "CLIENT") {
      return sendHome();
    }
    if (pathname.startsWith("/driver") && role !== "LIVREUR") {
      return sendHome();
    }
  }

  return NextResponse.next();
}

// Apply middleware to all routes except :
export const config = {
  matcher: [
    "/((?!api|icons|images|manifest|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|sitemap.xml|robots.txt).*)",
  ],
};
