import { redact } from "../db.js";
import { handleApiRequest, parseJsonBody } from "../server.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function failure(error) {
  if (error?.publicMessage) return json(error.status || 503, { error: error.publicMessage });
  if (error?.status && error.status < 500) return json(error.status, { error: error.message });
  console.error(redact(error));
  return json(500, { error: "Сбой сервера" });
}

function requestUrl(request) {
  const current = new URL(request.url);
  if (current.pathname !== "/api" && current.pathname !== "/api/") return current;
  const original =
    request.headers.get("x-vercel-original-url") ||
    request.headers.get("x-forwarded-uri") ||
    request.headers.get("x-invoke-path");
  if (!original || original === current.pathname) return current;
  try {
    return original.startsWith("http://") || original.startsWith("https://")
      ? new URL(original)
      : new URL(original, current.origin);
  } catch {
    return current;
  }
}

export default {
  async fetch(request) {
    const method = request.method || "GET";
    try {
      const url = requestUrl(request);
      let body;
      if (method !== "GET" && method !== "HEAD") {
        body = parseJsonBody(await request.text());
      }
      const forwarded = request.headers.get("x-forwarded-for");
      const ip = forwarded ? forwarded.split(",")[0].trim() : "local";
      const result = await handleApiRequest({ method, url, body, ip });
      return json(result.status, result.data);
    } catch (error) {
      return failure(error);
    }
  },
};
