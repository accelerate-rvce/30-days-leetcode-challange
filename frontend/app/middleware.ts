import { NextRequest, NextResponse } from "next/server";

const VALID_PATHS = new Set([
  "/",
  "/challenge",
  "/progress",
  "/resources",
  "/leaderboard",
  "/support",
  "/admin",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (VALID_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}
