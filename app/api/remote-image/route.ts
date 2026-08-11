import "server-only";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side proxy that fetches a remote image and streams the bytes back to
 * the browser. This exists because the browser cannot fetch some remote image
 * hosts directly: either they send no CORS headers (so the browser blocks the
 * response even when the request succeeds), or a browser extension rewrites
 * `fetch`. Both surface as a generic `TypeError: Failed to fetch` in the
 * client, which is exactly what was happening when the supplier-image dialog
 * tried to `fetch()` an `imageUrl` from the-eland.co to "Use this image".
 *
 * The route is intentionally narrow:
 *   - GET only.
 *   - Requires a single `url` query param.
 *   - Allows only image/* responses (inspected from the upstream MIME, not the
 *     URL string).
 *   - Hard-caps the upstream at REMOTE_IMAGE_MAX_BYTES so a stray giant URL
 *     can't be streamed through.
 *
 * This is SSRF-exposed by design — any signed-in user can ask the server to
 * fetch a URL. We rely on the app's existing auth boundary (the route is
 * reached only through the authenticated Next.js app) and the MIME + size
 * guards. If this needs tightening later, restrict the allowed hosts here.
 */

const REMOTE_IMAGE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB, matches the upload cap.
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const ALLOWED_MIME_PREFIX = "image/";

function upstreamError(message: string, status = 502): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url query parameter." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url query parameter." }, { status: 400 });
  }
  // Only fetch http(s) URLs — refuse file:, data:, etc.
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http and https URLs are supported." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      signal: controller.signal,
      // Don't forward cookies/credentials — this is a third-party host.
      credentials: "omit",
      redirect: "follow",
      headers: { Accept: "image/*" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return upstreamError("The remote image took too long to respond.", 504);
    }
    const message = error instanceof Error ? error.message : "The remote image could not be reached.";
    return upstreamError(message);
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    return upstreamError(
      `The remote host responded ${upstream.status}.`,
      upstream.status === 404 ? 404 : 502,
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(ALLOWED_MIME_PREFIX)) {
    return upstreamError("The remote URL did not return an image.");
  }

  // Read into a buffer (images are small) and enforce the size cap before
  // forwarding. Streaming passthrough would be lighter but loses the size guard.
  const contentLengthHeader = upstream.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > REMOTE_IMAGE_MAX_BYTES) {
      return upstreamError("The remote image exceeds the 20 MB limit.", 413);
    }
  }

  const arrayBuffer = await upstream.arrayBuffer();
  if (arrayBuffer.byteLength > REMOTE_IMAGE_MAX_BYTES) {
    return upstreamError("The remote image exceeds the 20 MB limit.", 413);
  }

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(arrayBuffer.byteLength),
      // Allow the browser to cache the proxied bytes (same SHA would repeat).
      "Cache-Control": "private, max-age=600",
      // Mark the response as same-origin-safe for the client `fetch` caller.
      "Access-Control-Allow-Origin": (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, ""),
    },
  });
}
