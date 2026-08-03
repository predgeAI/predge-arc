# Deck outline — 7 slides (Arc "Programmable Money" · Agentic Economy track)

## 1. Title
**Predge on Arc — agents buy intelligence with native USDC**
Subtitle: pay-per-call whale data, settled on Circle Arc; the receipt IS the
access credential.
Footer: live x402 API in production · contract live on Arc testnet.

## 2. Problem — APIs are built for humans, buyers are now machines
- Agents can't pass KYC, hold cards, or manage seat-based plans.
- x402 fixed the request loop; settlement still runs on chains where USDC is
  "just another ERC-20": approvals, gas tokens, bridges — for a $0.005 call.
- Machine commerce needs one primitive, not a payment stack.

## 3. Why Arc — the money is the chain
- USDC is Arc's **native token**: `msg.value` IS the payment; gas and value
  are the same asset the agent already holds.
- One tiny immutable contract (`PredgeSettlement`, ~60 lines): `payForRoute`
  + `Paid` event. No approvals, no upgradability, no custody in the service.
- Receipts are events: cheap, indexable, verifiable by anyone.

## 4. What we built — the loop (architecture slide)
Diagram: agent → 402 quote → `payForRoute(route_hash, request_id)` → `Paid`
event → gateway verifies on-chain (or finds the event itself by memo) → data.
- Gateway holds **no private key** — read-only chain access.
- One payment = one unlock (replay → 409).
- Live prod context: Predge x402 API on Base + Solana, $0.005–$0.03/call,
  ed25519-signed responses.

## 5. Live demo (screenshots + explorer links)
- Purchase 1: `/v1/whales/latest`, $0.005 — redeemed by tx hash.
- Purchase 2: `/v1/wallets/leaderboard`, $0.01 — gateway discovered the
  payment event on-chain by request-id memo.
- Both txs on testnet.arcscan.app; contract `0x3474Bd27…C82A5`.

## 6. Differentiator — anchored trust
- Predge's paid calls are signed + hash-chained (tamper-evident).
- `anchor.mjs` freezes the chain head into an Arc `Paid` receipt →
  tamper-**proof**: even the operator can't rewrite history.
- Anchored digest is reproducible by anyone (`curl | shasum -a 256` matches
  the on-chain meta). `--verify` proves anchoring by scanning events.
- Machine buyers don't take promises — they take receipts.

## 7. Honesty + roadmap
- Pre-existing: production x402 API; settlement contract deployed pre-event
  (disclosed). Built at the hackathon: gateway, agent, anchoring, demo txs.
- Demo payloads: frozen samples in exact prod shapes (`data_source: sample`)
  — all payments/receipts real; no prod credentials in the repo.
- Next: Arc rail in the production 402 `accepts[]` alongside Base + Solana;
  automated chain-head anchoring per N calls; receipts as portable
  agent-reputation primitives.
