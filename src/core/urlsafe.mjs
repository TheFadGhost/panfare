// urlsafe.mjs — one allow-list for anything that becomes an <a href> or a
// markdown/printable link. Crafted pages can plant javascript: URLs in
// schema.org fields; only http(s) ever passes.

const SAFE_SCHEME = /^https?:\/\//i;

/** -> the URL string when safe, otherwise null. */
export function safeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  if (!s || !SAFE_SCHEME.test(s)) return null;
  // strip control characters that could smuggle schemes past naive parsers
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;
  return s;
}
