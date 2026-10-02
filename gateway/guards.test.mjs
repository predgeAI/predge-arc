// node --test gateway/guards.test.mjs — no chain, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { QuoteStore, cachedBlockNumber, clientKey, makeLimiter } from "./guards.mjs";

const quote = (createdAt) => ({ redeemToken: randomBytes(32).toString("hex"), createdAt, path: "/v1/whales/latest" });

test("QuoteStore refuses new quotes when full instead of growing", () => {
  let t = 1_000;
  const store = new QuoteStore({ maxLive: 3, evictMs: 60_000, now: () => t });
  for (let i = 0; i < 3; i++) assert.equal(store.add(`id${i}`, quote(t)), true);
  assert.equal(store.add("id3", quote(t)), false);
  assert.equal(store.size, 3);
  // Once the oldest outlive evictMs, room is made again.
  t += 60_001;
  assert.equal(store.add("id4", quote(t)), true);
  assert.equal(store.size, 1);
});

test("QuoteStore finds a quote by its exact redeem token only", () => {
  const store = new QuoteStore();
  const q = quote(Date.now());
  store.add("req-1", q);
  assert.deepEqual(store.forToken(q.redeemToken), { requestId: "req-1", q });
  const flipped = q.redeemToken.slice(0, -1) + (q.redeemToken.endsWith("0") ? "1" : "0");
  assert.equal(store.forToken(flipped), null);
  assert.equal(store.forToken(q.redeemToken.slice(0, 10)), null);
  assert.equal(store.forToken(""), null);
  assert.equal(store.forToken(undefined), null);
});

test("QuoteStore token lookup does not scan: 20k live quotes stay fast", () => {
  const store = new QuoteStore({ maxLive: 20_000 });
  let last;
  for (let i = 0; i < 20_000; i++) {
    last = quote(Date.now());
    store.add(`r${i}`, last);
  }
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1_000; i++) store.forToken(randomBytes(32).toString("hex"));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `1000 lookups took ${ms} ms`);
  assert.equal(store.forToken(last.redeemToken).requestId, "r19999");
});

test("evicted quotes no longer unlock with their token", () => {
  let t = 0;
  const store = new QuoteStore({ evictMs: 10, now: () => t });
  const q = quote(t);
  store.add("old", q);
  t = 11;
  store.evict();
  assert.equal(store.forToken(q.redeemToken), null);
  assert.equal(store.get("old"), undefined);
});

test("makeLimiter allows `limit` hits per window per key", () => {
  let t = 0;
  const allow = makeLimiter({ limit: 2, windowMs: 1_000, now: () => t });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  t = 1_000;
  assert.equal(allow("a"), true);
});

test("clientKey takes the leftmost X-Forwarded-For entry, else the socket", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" } }), "198.51.100.7");
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "10.1.2.3" } }), "10.1.2.3");
});

test("cachedBlockNumber hits the RPC once per TTL, shared by concurrent callers", async () => {
  let t = 0;
  let calls = 0;
  const fetchBlock = async () => {
    calls += 1;
    return 100 + calls;
  };
  const latest = cachedBlockNumber(fetchBlock, 2_000, () => t);
  const vals = await Promise.all(Array.from({ length: 50 }, () => latest()));
  assert.equal(calls, 1);
  assert.ok(vals.every((v) => v === 101));
  t = 1_999;
  assert.equal(await latest(), 101);
  t = 2_000;
  assert.equal(await latest(), 102);
  assert.equal(calls, 2);
});

test("cachedBlockNumber does not cache a failure", async () => {
  let fail = true;
  const latest = cachedBlockNumber(async () => {
    if (fail) throw new Error("rpc down");
    return 7;
  });
  await assert.rejects(latest());
  fail = false;
  assert.equal(await latest(), 7);
});
