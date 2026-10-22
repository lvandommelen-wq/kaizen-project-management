import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfigurationIssues } from "@/lib/auth";
import { getCurrentUser } from "@/lib/current-user";
import { isExternalGateReviewAccessEnabled } from "@/lib/pilot-policy";

export async function proxy(request: NextRequest) {
  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (getAuthConfigurationIssues().length > 0) {
    signInUrl.searchParams.set("error", "configuration");
    return NextResponse.redirect(signInUrl);
  }

  try {
    const user = await getCurrentUser(request.headers);
    if (!user) return NextResponse.redirect(signInUrl);

    if (
      request.nextUrl.pathname.startsWith("/reviews")
      && !isExternalGateReviewAccessEnabled()
    ) {
      return NextResponse.redirect(new URL("/access-denied?reason=pilot", request.url));
    }

    if (
      user.status !== "active" ||
      (request.nextUrl.pathname.startsWith("/projects") && user.accessClass !== "internal")
    ) {
      const deniedUrl = new URL("/access-denied", request.url);
      if (user.status !== "active") deniedUrl.searchParams.set("reason", "inactive");
      return NextResponse.redirect(deniedUrl);
    }

    return NextResponse.next();
  } catch {
    signInUrl.searchParams.set("error", "unavailable");
    return NextResponse.redirect(signInUrl);
  }
}

export const config = {
  matcher: ["/projects/:path*", "/reviews/:path*"],
};
