// Abuse guards for the arc-gateway (security review 2026-10-03).
//
// Every unauthenticated GET of a catalog route minted a quote: one Map entry
// kept for an hour and one RPC call to Arc's public, rate-limited endpoint.
// Nothing bounded either, and redeem-token lookup scanned every live quote.
// So a caller could grow memory until the process died, burn the RPC quota the
// gateway needs to verify real payments, and make every redemption O(quotes).
//
//   QuoteStore         bounded store with O(1) token lookup (hash index) and a
//                      constant-time confirm of the token itself.
//   makeLimiter        fixed-window per-client counter for chain-touching routes.
//   cachedBlockNumber  one getBlockNumber per TTL, shared by concurrent callers.
//
// Dependency-free so it is unit-testable without a chain (gateway/guards.test.mjs).
import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

export class QuoteStore {
  constructor({ maxLive = 20_000, evictMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxLive = maxLive;
    this.evictMs = evictMs;
    this.now = now;
    this.byId = new Map();
    this.byTokenHash = new Map();
  }

  get size() {
    return this.byId.size;
  }

  /** Store a quote. Returns false when full (the caller answers 503, not a quote). */
  add(requestId, q) {
    if (this.byId.size >= this.maxLive) this.evict();
    if (this.byId.size >= this.maxLive) return false;
    this.byId.set(requestId, q);
    this.byTokenHash.set(sha256(q.redeemToken), requestId);
    return true;
  }

  get(requestId) {
    return this.byId.get(requestId);
  }

  /**
   * The quote a redeem token unlocks, or null. The index is keyed by the
   * token's sha256, so the lookup reveals nothing about how close a guess was,
   * and the stored token is still confirmed with timingSafeEqual.
   */
  forToken(token) {
    if (typeof token !== "string" || token.length === 0) return null;
    const requestId = this.byTokenHash.get(sha256(token));
    if (!requestId) return null;
    const q = this.byId.get(requestId);
    if (!q) return null;
    const a = Buffer.from(token);
    const b = Buffer.from(q.redeemToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { requestId, q };
  }

  /** Drop quotes older than evictMs (same lifetime the gateway always used). */
  evict() {
    const t = this.now();
    for (const [id, q] of this.byId) {
      if (t - q.createdAt > this.evictMs) {
        this.byId.delete(id);
        this.byTokenHash.delete(sha256(q.redeemToken));
      }
    }
  }
}

/** Fixed-window counter: allow(key) is true for the first `limit` hits per window. */
export function makeLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 50_000 }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    let e = hits.get(key);
    if (!e || t >= e.reset) {
      e = { n: 0, reset: t + windowMs };
      hits.set(key, e);
    }
    e.n += 1;
    if (hits.size > maxKeys) {
      for (const [k, v] of hits) if (t >= v.reset) hits.delete(k);
    }
    return e.n <= limit;
  };
}

/**
 * Client key for rate limiting: the leftmost X-Forwarded-For entry. Railway's
 * edge writes it (a client-sent X-Forwarded-For does not move it — checked
 * against api.predge.io on 2026-10-03), falling back to the socket address.
 */
export function clientKey(req) {
  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
}

/**
 * Wrap fetchBlock so it hits the RPC at most once per ttlMs; concurrent callers
 * share the in-flight request. A quote's createdBlock only marks where the
 * payment scan starts, so a block number up to ttlMs old is safe: the scan
 * starts slightly earlier, and a payment made after the quote cannot be missed.
 */
export function cachedBlockNumber(fetchBlock, ttlMs = 2_000, now = () => Date.now()) {
  let value = null;
  let at = 0;
  let inflight = null;
  return async function blockNumber() {
    if (value !== null && now() - at < ttlMs) return value;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const v = await fetchBlock();
        value = v;
        at = now();
        return v;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
