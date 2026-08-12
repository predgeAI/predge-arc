# Integrating Cachet (`PredgeOracle`) — outcome resolution on Circle Arc

You are building something on Arc that has to pay out when a real-world question
gets an answer. Cachet is the answer, plus the on-chain evidence that the answer
was committed to **before it was knowable** and has never been edited since.

Reading it is free. There is no key, no account, no allowlist, no fee, and no
integration call with us — which is why this document exists.

---

## The 30-second version

```solidity
import {IPredgeOracle} from "predge-arc/contracts/IPredgeOracle.sol";

IPredgeOracle constant ORACLE =
    IPredgeOracle(0xF160AbE664C34CF4C117101b4308bb16325a1ABc); // Arc testnet

(bool resolved, IPredgeOracle.Outcome outcome, , , , ) = ORACLE.getResolution(marketId);
if (!resolved) revert NotResolvedYet();
if (outcome == IPredgeOracle.Outcome.Invalid) { refundEveryone(); }
else if (outcome == IPredgeOracle.Outcome.Yes) { payYes(); }
else { payNo(); }
```

That is the whole mechanical integration. The rest of this page is the part that
decides whether your users keep their money: **[Integration hazards](#integration-hazards)**.

## Deployed addresses

Arc **testnet**, chainId `5042002`, explorer `https://testnet.arcscan.app`.

| Contract | Address | Role |
|---|---|---|
| `PredgeOracle` (Cachet) | [`0xF160AbE664C34CF4C117101b4308bb16325a1ABc`](https://testnet.arcscan.app/address/0xF160AbE664C34CF4C117101b4308bb16325a1ABc) | commit → resolve registry. **This is the one you integrate against.** |
| `ExampleMarket` | [`0x0A63f412B9Af24a92B04ad596F32D4568A0212CD`](https://testnet.arcscan.app/address/0x0A63f412B9Af24a92B04ad596F32D4568A0212CD) | a real consumer, deployed and settled end-to-end. Read it — it is the reference implementation of every hazard below. |
| `PredgeSettlement` | [`0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5`](https://testnet.arcscan.app/address/0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5) | unrelated to resolution: x402 payment receipts, and it holds the key-registry hash anchor. |

Addresses are nonce-derived, not CREATE2. **The same address on another chain is
not this contract.** Check `block.chainid` if your deployment script can target
more than one network.

## The surface

Everything in `contracts/IPredgeOracle.sol` is a free `view` or `pure`.

| Function | Returns | Use it for |
|---|---|---|
| `getResolution(bytes32)` | `(resolved, outcome, contentHash, preCommitHash, committedAt, resolvedAt)` | **the one to build on** — the outcome *and* the evidence, in one call |
| `isResolved(bytes32)` | `bool` | cheapest gate; close betting the instant it flips |
| `outcomeOf(bytes32)` | `Outcome` | only when you already know it is resolved (see hazard 1) |
| `isCommitted(bytes32)` | `bool` | the opening-time gate — refuse to accept stakes without it |
| `commitLeadTime(bytes32)` | `uint64` seconds | how long the outcome stayed open after the commitment |
| `attestationRef(bytes32)` | `string` | off-chain evidence pointer. **Never call from a state-changing path** (hazard 9) |
| `marketIdFor(string,string)` | `bytes32` | derive the key the same way the oracle does |

`Outcome` is `{ Unresolved = 0, Yes = 1, No = 2, Invalid = 3 }`.

Two events, both emitted by the oracle address only:

```solidity
event MarketCommitted(bytes32 indexed marketId, bytes32 indexed preCommitHash, uint64 committedAt, string marketRef);
event MarketResolved(bytes32 indexed marketId, Outcome indexed outcome, bytes32 indexed contentHash,
                     bytes32 preCommitHash, uint64 committedAt, uint64 resolvedAt, string attestationRef);
```

`MarketResolved` carries the commitment fields too, so an indexer computes the
lead time from a single log without joining back to the commit.

## A minimal consumer

Copy-pasteable, and every line that looks like paranoia is a hazard from the next
section:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPredgeOracle} from "./IPredgeOracle.sol";

contract MinimalConsumer {
    /// Immutable. A repointable oracle destroys the entire guarantee (hazard 8).
    IPredgeOracle public immutable oracle;
    bytes32 public immutable marketId;
    /// If the oracle never speaks, funds must still come home (hazard 6).
    uint64 public immutable voidAfter;

    IPredgeOracle.Outcome public finalOutcome;
    bool public settled;
    bool public voided;

    error NotPreCommitted();
    error AlreadyKnown();
    error NotResolved();
    error AlreadySettled();

    constructor(address oracle_, bytes32 marketId_, uint64 voidAfter_) {
        IPredgeOracle o = IPredgeOracle(oracle_);
        // Predge must have pre-committed, and must NOT already know the answer.
        if (!o.isCommitted(marketId_)) revert NotPreCommitted();   // hazard 4
        if (o.isResolved(marketId_)) revert AlreadyKnown();        // hazard 4
        oracle = o;
        marketId = marketId_;
        voidAfter = voidAfter_;
    }

    /// Permissionless and callable exactly once. No arguments — there is nothing
    /// for a caller to decide (hazard 10).
    function settle() external {
        if (settled) revert AlreadySettled();

        (bool resolved, IPredgeOracle.Outcome outcome, , , uint64 committedAt, uint64 resolvedAt)
            = oracle.getResolution(marketId);

        if (!resolved) {
            // No callback exists. Either the oracle has not spoken yet, or it
            // never will — and "never" must not mean "funds locked forever".
            if (block.timestamp <= voidAfter) revert NotResolved();
            voided = true;                                          // refund mode
        } else {
            // A resolution committed and recorded in the same block is valid but
            // uninformative. Pick your own floor (hazard 5).
            if (resolvedAt - committedAt < 60) { voided = true; }
            // Invalid is a settled state, not an error. It must not be a loss
            // for either side (hazard 3).
            else if (outcome == IPredgeOracle.Outcome.Invalid) { voided = true; }
            else { finalOutcome = outcome; }
        }
        settled = true;
    }

    /// Stakes close at the deadline OR the instant the oracle speaks, whichever
    /// comes first — otherwise the resolution is a free option (hazard 7).
    function isOpen(uint64 deadline) public view returns (bool) {
        return block.timestamp < deadline && !oracle.isResolved(marketId);
    }
}
```

`contracts/ExampleMarket.sol` is the same shape with real money in it: two-sided
native-USDC staking, pull payments, an explicit reentrancy guard, a proven-solvent
rounding direction, and a 90-day `RESOLUTION_GRACE` void path. It is deployed and
has settled a real market end-to-end — [`0x0A63f412…0212CD`](https://testnet.arcscan.app/address/0x0A63f412B9Af24a92B04ad596F32D4568A0212CD).

## Deriving `marketId`

```
marketId = keccak256(abi.encode(platform, marketRef))
```

```solidity
bytes32 id = keccak256(abi.encode("polymarket", "0x1234..."));  // on-chain
```

```js
import { AbiCoder, keccak256 } from "ethers";                    // off-chain
const id = keccak256(AbiCoder.defaultAbiCoder().encode(["string","string"], [platform, ref]));
```

`abi.encode`, **never** `abi.encodePacked` — see hazard 15.

---

## Integration hazards

Ordered roughly by how fast they cost someone money.

### 1. `Unresolved` is the zero value. "Not resolved" is not a NO.

An unknown market, a mistyped `marketId`, and a market that is genuinely still
open all return `Outcome.Unresolved` — which is `0`. So this is a fund-losing bug:

```solidity
if (outcome == Outcome.Yes) payYes(); else payNo();   // WRONG
```

A pending market pays the NO side. So does a typo. Always branch on `resolved`
first, and make the final `else` an explicit `Outcome.No` check rather than a
catch-all.

### 2. A wrong `marketId` looks exactly like a pending market — forever.

`getResolution` on a key that was never committed returns all zeros with
`resolved == false`. There is no "unknown market" error, because there is nothing
in storage to distinguish. Your market will sit "pending" until the heat death of
the universe while everyone assumes Predge is slow.

**Do:** derive the id with `marketIdFor` (or the identical `abi.encode`) and gate
your constructor on `isCommitted`. That turns a bad key into a deploy-time revert
instead of a permanently stuck pool.

### 3. `Invalid` is a settled state, not an error code.

`Invalid` means the market voided: the event never happened, the question was
malformed, the source was withdrawn. It is recorded honestly rather than being
squeezed into YES/NO. **It is not a loss for either side.** Mapping `Invalid` to
NO confiscates the YES stakes because nothing happened, which is theft with extra
steps. Refund both sides.

The same logic covers a second no-winner case the oracle can't tell you about:
if the *winning* side has zero stakes, there is nobody to pay the losing pool to.
Refund there too, or you strand the funds forever (or, worse, hand them to
whoever wrote the contract).

### 4. Check `isCommitted` **before** you accept a single unit of stake.

Nothing stops someone deploying your market contract with an arbitrary `bytes32`.
If Predge never pre-committed to it, `postResolution` will revert forever — the
oracle refuses to resolve an uncommitted market by design — so the pool can never
settle. Check `isCommitted(marketId)` in the constructor.

And check `!isResolved(marketId)` in the same breath. A pool opened on a market
that is *already* settled is a pool opened on a known result, and the deployer is
the one who knows it.

### 5. `commitLeadTime` returns `0` for two very different things.

It returns `0` when the market is unresolved, **and** when it was committed and
resolved inside the same block — which is precisely the pathological case you
would want a lead-time check to catch. Reading `0` as "no lead time recorded yet"
and proceeding is the trap.

**Do:** read `resolved` from `getResolution` first; only then is a small lead time
meaningful. Then set your own floor and refuse below it. A commitment made
seconds before a known outcome is structurally valid — the ordering guarantee
holds — and it still tells you something. `ExampleMarket`'s reference run had a
17-second lead; a market whose real-world question resolves weekly should expect
days.

Block timestamps are validator-influenced at second scale, so don't set a
threshold tighter than the chain's own tolerance.

### 6. Liveness is not guaranteed. Nothing here promises you an answer.

The publisher can commit and then go silent forever — key loss, infrastructure
death, a source that never publishes. The contract has no mechanism to compel a
resolution and neither do you.

**If your contract holds user funds, it MUST have a timeout that voids to
refunds.** Without one, "the oracle went quiet" becomes "the money is gone".
`ExampleMarket` waits `RESOLUTION_GRACE = 90 days` past the betting deadline and
then refunds every staker exactly their own stake. Note what that path is *not*:
it is permissionless, time-based, pays no side, and is unreachable while a
resolution exists. A timeout that lets an admin pick a winner is just an admin.

### 7. Close your market on resolution, not only on your deadline.

If your betting deadline is later than the resolution, anyone watching for
`MarketResolved` can stake on the now-known winner and take the losing pool
risk-free. Your deadline is a guess about when the answer arrives; the oracle is
the fact.

```solidity
if (block.timestamp >= deadline) revert BettingClosed();
if (oracle.isResolved(marketId)) revert BettingClosed();   // the one people forget
```

### 8. The oracle address must be `immutable`.

If your contract has `setOracle()`, or lives behind an upgradeable proxy, then
every guarantee on this page evaporates: whoever holds that admin key can point
your settlement at a friendlier contract *after* the money arrives. A staker who
checked `oracle()` before staking checked nothing.

`immutable` fixes the address in deploy bytecode. That leaves the staker exactly
one check to do, once, before staking: that `oracle()` is the real deployment
above. Nothing on-chain can do that check for them — the same way nothing stops a
token pair from pointing at a fake token — so say so in your UI rather than
papering over it.

### 9. Never call `attestationRef` from a state-changing path.

It returns a publisher-controlled, unbounded string. Solidity copies the whole
return value into memory, so a long enough `attestationRef` makes any function
that reads it too expensive to call — and if that function is your `settle()`,
your market is bricked by a value you don't control.

Read it from your indexer, your UI, or an off-chain verifier. Never from the
money path.

### 10. There is no callback. Settlement is something *you* trigger.

Free views mean nobody can gas-grief you and you never pay to read — but also
that the oracle will never call you. Nothing happens in your contract when a
market resolves.

**Do:** make `settle()` permissionless, argument-free (there is nothing for a
caller to decide — it copies the oracle verbatim) and idempotent-once: it freezes
the payout rule on first call and reverts afterwards. Then any keeper, any user,
any bot can advance the market and none of them can influence it. A settlement
that only your keeper can call is a liveness dependency you added yourself.

### 11. A matching event topic is not an identity. Filter by address.

Anyone can deploy a contract that emits `MarketResolved` with identical topics.
An indexer keyed on `topic0` alone will happily ingest a fake resolution. Filter
on `log.address == 0xF160AbE664C34CF4C117101b4308bb16325a1ABc`, always. Same for
`MarketCommitted`.

### 12. The pre-commitment binds the *call*, not the *resolver*.

`publisher` is rotatable by the oracle's `owner`. Rotation can never rewrite a
past record — that part is airtight. But for a market that is committed and **not
yet resolved**, a rotated publisher key can write the resolution. The chain
guarantees the ordering; it does not guarantee the identity of whoever eventually
posts the outcome.

If that matters to your protocol, snapshot `publisher()` at deploy time and check
it at settlement (declare the getter yourself — it is deliberately absent from
`IPredgeOracle`, since depending on it means depending on our key management
rather than on the chain's ordering guarantee). Understand what you are buying:
it protects you from a rotation, not from the current key.

### 13. Out-of-range enum decoding panics — fail-closed only helps if you have a timeout.

Solidity reverts with `Panic(0x21)` when it decodes a value outside the enum
range. So if you ever point at something that isn't this contract, or a future
deployment with more `Outcome` members, your settlement path reverts permanently
rather than mis-paying. That is the right failure — but "permanently reverting
settlement" is *also* how funds get locked forever. It is hazard 6 again from a
different direction: the timeout path is what makes fail-closed survivable.

### 14. On-chain reads are consistent; off-chain reads need finality.

A contract reading the oracle in the same transaction sees a state that either
happened or didn't, together with its own writes. An off-chain settler reading
over RPC does not: act on an unfinalized block and a reorg can unwind the
resolution under you, while whatever you did off-chain (paid a user, released
goods) does not unwind. Wait for the chain's finality before acting on a read
outside the EVM. Arc's finality is deterministic; the discipline is still yours.

### 15. `abi.encode`, never `abi.encodePacked`, for the market key.

Packing two dynamic strings around a separator is ambiguous: `("a", "b:c")` and
`("a:b", "c")` both pack to `"a:b:c"` and collide onto one key. Since a
resolution is write-once, a collision lets one market's outcome permanently
occupy another market's slot — unrecoverable, by design. The contract uses
length-prefixed `abi.encode` for exactly this reason. Match it.

---

## Verifying a resolution off-chain

The chain proves ordering and immutability. To also check that the signed bytes
behind the hash say what Predge claims, verify them yourself:

```
node verify-cachet.mjs 0x7bd8746e2832545a34ca4685d7a8972c7c862961a78366f812a166de8fc3ad0b --deep

[1] PASS  resolved as YES; committed 4s before the outcome was recorded
[2] PASS  keccak256(canonical) == the chain's contentHash · via on-chain (embedded)
[3] PASS  ed25519 signature valid · key a122cc09…d997e4
[4] PASS  key listed and active · kid a122cc095c0f7fe5
[5] PASS  registry hash anchored on-chain · sha256 3229c5f0…feb96f
VERIFIED
```

`verify-cachet.mjs` is a single standalone file. It imports no Predge code, holds
no secret, and needs nothing but a public Arc RPC endpoint. Read it before you
trust it — that is the point. Anything that fails prints `FAIL` and exits
non-zero.

The key registry it checks against is public:

```
https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json
```

It publishes the `cachet-oracle` role key, kid `a122cc095c0f7fe5`, and the
registry's **own sha256 is anchored on Arc** — so even the key list is attested
by the chain rather than by a web server that could be swapped tomorrow. Step 5
(`--deep`) is what checks that. Reproduce the digest yourself:

```
curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256
```

Two things worth knowing before you build a dispute process on this:

- If a resolution's `attestationRef` is a **URL** and that URL is gone, step 2
  fails — a hash whose preimage lives on a web server proves only that
  *something* was committed. Resolutions published with `--embed` carry the whole
  signed envelope on-chain and verify even if predge.io disappears entirely. If
  your audit story needs the bytes later, archive them at commitment time.
- A signature under a key that isn't in the registry passes steps 1–3 and fails
  at step 4, because a signature under an unpublished key proves only that
  *someone* signed.

## What this is NOT

Stated plainly, because you are about to route money through it.

- **Not a guarantee that the outcome is true.** It guarantees the outcome was
  committed to before it was knowable and has never been edited. That is a
  different property from correctness — a checkable one, which is the point, but
  do not let it be sold to you as omniscience.
- **Not decentralised.** One publisher, today. There is no committee, no staking
  set, no slashing, no dispute game. What that buys you is that there is also no
  token vote that can rewrite a settled result after the money is known — the
  failure mode this exists to remove. What it costs you is that Predge's
  off-chain verification is a trust assumption, disclosed at the top of
  `IPredgeOracle.sol` and not hidden anywhere.
- **Not a liveness commitment.** See hazard 6. Build the timeout.
- **Testnet.** Arc testnet, chainId 5042002. Do not put mainnet-equivalent value
  behind a testnet deployment.
- **Scoped to binary-ish outcomes.** `Yes / No / Invalid`. No scalar outcomes, no
  multi-outcome categoricals, no ranges, no partial resolutions. A market that
  needs "which of six candidates" needs six markets, and you own the logic that
  makes them mutually exclusive.
- **Not an entitlement to be listed.** Predge commits to the markets Predge
  chooses to commit to. If your market isn't in the registry, no amount of
  integration makes it resolvable — `postResolution` reverts on an uncommitted
  market, which is the same guarantee working in the direction you don't want.

## Checking the interface hasn't drifted

`contracts/IPredgeOracle.sol` is a hand-written subset of the deployed contract,
which means it could rot. It can't rot silently:

```
node --test docs/interface-drift.test.mjs
```

Compiles the interface and the contract from source with the repo's own solc and
asserts they agree entry for entry — argument types, **return types** (a selector
would not catch a reordered return tuple), mutability, event indexing, selectors
and topic hashes. It also checks the inline copy inside `ExampleMarket.sol` and
the human-readable ABI the publisher CLI transacts with. Offline; no RPC.
