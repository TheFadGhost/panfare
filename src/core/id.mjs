// id.mjs — one collision-resistant id generator for every record type.

function randomSlug() {
  const buf =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(6))
      : Uint8Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("");
}

/** "r_k3x9q2ab" style ids: prefix + timestamp + randomness. */
export function makeId(prefix) {
  const time = Date.now().toString(36);
  return String(prefix) + "_" + time + randomSlug();
}
