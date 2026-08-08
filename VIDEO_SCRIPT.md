# Demo video script — 3:00

Format: screen recording (terminal + browser), voiceover. Two terminals side
by side: left = gateway (already running), right = agent. Browser tabs
pre-opened: Arc explorer contract page, Predge prod API root.

**Ordering principle: the agent pays and gets data in the first 20 seconds.**
Every explanation rides on top of something already moving on screen — nobody
watches a hackathon demo to hear what a project *is* before seeing it work.

Practice once; on-chain waits are 5–15 s each and the script absorbs them.

---

**[0:00–0:20] Cold open — no preamble. Run it.**

Hit Enter on `node agent.mjs` before saying a word. Let the 402, the payment
and the unlocked data print while you talk.

> "An AI agent just paid half a cent of USDC for market intelligence. Its own
> wallet, no API key, no account, no card — and the payment is native on Circle
> Arc. That whole loop took twelve seconds. Here's what happened."

**[0:20–0:50] Replay what they just saw — point at the lines.**

Scroll back through the agent output, cursor on each step.

> "The agent asked for whale trades and got HTTP 402 — a machine-readable
> quote: contract, route hash, amount, one-time request id. It called
> `payForRoute`, and here's the Arc part — `msg.value` **is** the USDC. Money
> and gas are the same asset, so no approvals, no bridges, no gas token to
> keep topped up. Then it retried with the tx hash, the gateway verified the
> receipt on-chain, and released the data."

Click the printed explorer link; show the `Paid` event.

> "That event is the payment, the access credential and the audit record, all
> at once."

**[0:50–1:20] Two properties worth pausing on.**

Show the gateway terminal, then re-run the agent with the same payment.

> "The seller holds **no private key** — it can only read the chain. Funds land
> in the contract; only the owner can withdraw. And the request id is
> single-use: replay the same payment and you get 409. One payment, one unlock."

**[1:20–1:50] Now — and only now — what Predge is.**

Browser: prod API root JSON.

> "This isn't a hackathon mock. Predge is a live pay-per-call API selling
> Polymarket whale intelligence to agents — over twenty routes, half a cent to
> three cents, every response ed25519-signed. It runs on x402 over Base and
> Solana today. Arc is where settlement finally becomes native."

**[1:50–2:35] The differentiator — anchoring. Prove it live.**

Run `node anchor.mjs --verify <hash>`, then the curl in a shell.

> "Signed responses are tamper-evident, but a hash chain can't stop the
> operator rewriting history wholesale. So we freeze the chain head into an Arc
> receipt."

Type the reproduction command on camera and let it print:

```
curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256
```

> "That digest — computed right now from our live key registry — is the exact
> hash sitting in the Arc transaction. Anyone can run this. Now not even we can
> rewrite our own audit trail. Agents buying intelligence don't need promises.
> They need receipts."

**[2:35–3:00] Close on the explorer.**

> "Contract, both purchases, the anchor — all live on Arc testnet, all linked
> in the repo. Predge on Arc: agents pay in the money they already hold, and
> every byte they buy comes with a receipt."

---

Recording notes:
- Terminal font ≥16pt; window ~100 columns so tx hashes don't wrap.
- Start the gateway **before** recording — its boot lines are not the story.
- Pre-fund the agent (`npm run setup-agent`) BEFORE recording.
- If the public RPC rate-limits mid-take, the scripts auto-retry — keep
  talking; the pause reads as real chain time.
- Do not show `.env` or any private key on screen at any point.
- The reproduction curl is the strongest 10 seconds in the video — do it live,
  never as a pre-baked screenshot.

## If you submit the DeFi track instead

Signal-Vault is a separate story and does **not** fit in the same three
minutes. Shoot it as its own video rather than appending it here — a demo that
covers two tracks lands as neither.

Its cold open is `node vault-keeper.mjs run --sample riskoff`: an autonomous
keeper verifies an ed25519-signed whale consensus off-chain and flips the
vault's on-chain posture LONG → SHORT. Disclose the trust boundary out loud
(the keeper verifies, the chain records the signal hash + attestation ref) —
judges respect a stated limit more than a glossed one. Note honestly that the
sample path is self-signed unless `BUYER_PRIVATE_KEY` is funded for the live
x402 feed.
