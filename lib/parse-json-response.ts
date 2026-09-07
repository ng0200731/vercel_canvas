/**
 * Safely parses a JSON API response body.
 *
 * Vercel/Next.js serve HTML error pages (404/500) when a route crashes or is
 * missing. Calling `res.json()` on such a body throws the confusing
 * `Unexpected token '<' ... is not valid JSON`. This returns the parsed value
 * when the response body is JSON, otherwise `null`, so callers can fall back
 * to a readable HTTP status instead of the cryptic parse error.
 */
export async function tryParseJsonResponse(
  response: Response,
): Promise<unknown | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}
