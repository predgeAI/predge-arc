// Offline ed25519 verification of a Predge attestation — the exact recipe
// published at https://data.predge.io/attest-verification.md and mirrored from
// predge-x402-api's server-side signer. Zero dependencies (node:crypto only).
//
// Wire format (predge-attest-v1):
//   attestation = {
//     version, issuer, algorithm: "ed25519",
//     public_key: <hex, raw 32-byte ed25519 point>,
//     canonical:  <the EXACT bytes that were signed>,
//     signature:  <hex, 64 bytes>,
//     payload:    <the same object, parsed>,
//     verify:     <recipe string>
//   }
//
// Trust chain: (1) the signature must verify over `canonical` under `public_key`;
// (2) re-canonicalising `payload` must reproduce `canonical` byte-for-byte (no
// smuggled bytes); (3) `public_key` must match an ACTIVE key in the live
// registry at /.well-known/predge-keys.json (key pinning). All three must hold.
import crypto from "node:crypto";

export const ATTEST_VERSION = "predge-attest-v1";
export const ATTEST_ISSUER = "predge.io";
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // 12 bytes

/** Deterministic JSON: keys sorted lexicographically at every level, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const parts = Object.keys(value)
    .sort()
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  return `{${parts.join(",")}}`;
}

/** Build a node:crypto public key from a raw 32-byte ed25519 point (hex). */
export function publicKeyFromRawHex(rawHex) {
  const raw = Buffer.from(String(rawHex).replace(/^0x/, ""), "hex");
  if (raw.length !== 32) throw new Error(`ed25519 public key must be 32 bytes, got ${raw.length}`);
  const spki = Buffer.concat([SPKI_ED25519_PREFIX, raw]);
  return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
}

/**
 * Pure signature check: does `signature` verify over `canonical` under
 * `public_key`, and does `payload` re-canonicalise to `canonical`?
 * Returns { valid, reason }.
 */
export function verifyAttestation(att) {
  if (!att || typeof att !== "object") return { valid: false, reason: "no attestation object" };
  const { public_key, canonical, signature, payload } = att;
  if (!public_key || !canonical || !signature) return { valid: false, reason: "missing public_key/canonical/signature" };
  if (payload !== undefined && canonicalJson(payload) !== canonical) {
    return { valid: false, reason: "payload does not re-canonicalise to canonical (tampered)" };
  }
  let ok;
  try {
    const pub = publicKeyFromRawHex(public_key);
    ok = crypto.verify(null, Buffer.from(canonical, "utf8"), pub, Buffer.from(signature, "hex"));
  } catch (e) {
    return { valid: false, reason: `verify error: ${e.message}` };
  }
  return { valid: ok, reason: ok ? "signature valid over canonical" : "signature does NOT match" };
}

/** Fetch the live Predge key registry (/.well-known/predge-keys.json). */
export async function fetchRegistry(url, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`registry fetch failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Pin an attestation's key against a registry: the public_key must belong to an
 * ACTIVE registry key. Returns { pinned, kid, reason }.
 */
export function pinAgainstRegistry(att, registry) {
  const keys = registry?.keys ?? [];
  const active = keys.filter((k) => k.active !== false);
  const hit = active.find((k) => String(k.public_key).toLowerCase() === String(att.public_key).toLowerCase());
  if (!hit) return { pinned: false, kid: null, reason: "public_key is not an active key in the registry" };
  return { pinned: true, kid: hit.kid ?? null, reason: `pinned to active registry key ${hit.kid ?? "?"}` };
}

/** Full check = signature valid AND payload intact AND key pinned to registry. */
export function verifyAndPin(att, registry) {
  const sig = verifyAttestation(att);
  if (!sig.valid) return { ok: false, ...sig, pinned: false, kid: null };
  const pin = pinAgainstRegistry(att, registry);
  return { ok: sig.valid && pin.pinned, reason: `${sig.reason}; ${pin.reason}`, valid: sig.valid, pinned: pin.pinned, kid: pin.kid };
}

/** Sign a payload with a private key → an attestation envelope (used to mint a
 *  clearly-labeled SELF-SIGNED sample when no live Base buyer key is present).
 *  This is NOT the live Predge key — it exists only so the sample exercises the
 *  identical verification path end-to-end. */
export function signAttestation(payload, privateKey, publicKey, extra = {}) {
  const canonical = canonicalJson(payload);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPub = spki.subarray(12).toString("hex");
  return {
    version: ATTEST_VERSION,
    issuer: extra.issuer ?? ATTEST_ISSUER,
    algorithm: "ed25519",
    public_key: rawPub,
    canonical,
    signature: signature.toString("hex"),
    payload,
    verify: "ed25519: verify `signature` (hex,64B) over UTF-8 bytes of `canonical` using `public_key` (hex, raw 32B point).",
    ...extra,
  };
}

/** Ephemeral ed25519 keypair for self-signed samples. */
export function ephemeralKeypair() {
  return crypto.generateKeyPairSync("ed25519");
}
