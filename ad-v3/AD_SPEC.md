# Predge intro v3 · spec

Product-launch style ad: one idea per scene, a big left-aligned headline and a live product
panel that does what the headline says. Light canvas for the product scenes, dark cinematic
opener and closer, amber accent. Same track, tempo, length and cut density as v2.

- **Length:** 69.23 s · 150 beats @ 130 BPM · 12 scenes, ~45 on-beat events (cuts, headline swaps, UI state changes).
- **Aspects:** 1920x1080 master, 1080x1080, 1080x1920 (`node build.mjs 169|sq|vt`).
- **Engine:** HyperFrames 0.8.143 composition (`index.html`, one paused GSAP timeline, seek-safe),
  rendered with `npx hyperframes render`; audio muxed with ffmpeg (`render-all.sh`).
- **Pixels:** all our own (HTML/CSS/SVG). No AI images or video, no screen capture, no stock photos.
  The opener background is a generated gradient mesh with an animated light leak and film grain.
- **Personas are generic** ("a lending desk", "an agent", "a vault", "a trader") and every persona
  scene carries a "Product illustration" label. No customer, revenue, win-rate or edge claims.

## Scenes (1 beat = 0.4615 s)

| # | beats | time (s) | scene | motion |
|---|---|---|---|---|
| 1 | 0–8 | 0.00–3.69 | Opener: wordmark, "Know when an outcome is actually final." | mesh drift, light leak sweep, grain; wordmark inverse-zoom arrival; zoom-through out |
| 2 | 8–24 | 3.69–11.08 | Hook: Montana Grizzlies vs. Idaho Vandals O/U 151.5. "A market resolves." / "Someone disputes it." / "Resolved is not final." | proposal row + challenge bar; DISPUTED stamp slams on beat 13; settles Over on beat 18; waterfall headline cuts |
| 3 | 24–32 | 11.08–14.77 | "Predge reads the disputes on-chain." UMA OO, Polymarket UMA adapter, Polygon logs into Predge, out to signed record, API, Telegram, on-chain guard | lines draw, amber pulses travel; pull-back into the drop |
| 4 | 32–46 | 14.77–21.23 | Drop: 3,005 · 2,666 · 323 · 33.5% (853 of 2,543) · 1 Jan to 2 Oct 2026 | amber flash, arrival zoom, count-ups, nudge-curve pans every 3 beats |
| 5 | 46–60 | 21.23–27.69 | A lending desk: "Price the risk before it settles." | risk toast, chip Proposed to Disputed, LTV 60% to 0%, borrowing power $57,610 to $28,690, cursor opens the record popover |
| 6 | 60–76 | 27.69–35.08 | An agent: "Agents pay per call." / "No account. No API key." | keycap press, terminal: 402, pay 0.03 USDC on Arc, 200 signed; free settlement check, verify, decision |
| 7 | 76–90 | 35.08–41.54 | A vault: "Funds wait for final." | cursor clicks Release, Blocked: MarketDisputed, stepper to Final, release succeeds; "Contracts on Solana · Arc · Arbitrum One" |
| 8 | 90–104 | 41.54–48.00 | A trader: "Know before it costs you." | lock-screen alert, tap, @predge_alerts_bot chat, Open record, then "Final: Over" |
| 9 | 104–120 | 48.00–55.38 | Proof: "Every answer is signed." / "Verify, don't trust." | signed record types in, offline verify, Valid |
| 10 | 120–134 | 55.38–61.85 | "One signed answer: is it final?" hub with lending desks, agents, vaults, traders | tiles land on beats, answers travel along the edges; exit upward |
| 11 | 134–144 | 61.85–66.46 | "Know when an outcome is actually final." (dark) | waterfall entry, slow push, pull-back |
| 12 | 144–150 | 66.46–69.23 | End card: wordmark, predge.io · app.predge.io · @PredgeAI | arrival zoom; music hard-stops here, ~2.8 s silent hold |

Seams follow one current (left, cut-the-curve, ±230 px, mirrored power4) with the grid ground
sliding on every seam as the carrier. Reserved vectors: zoom-through out of the opener, pull-back
into the drop and arrival on the drop, upward exit from the hub (conclusion), arrival on the end card.

## On-screen claims and sources

| Claim | Source |
|---|---|
| 3,005 UMA disputes on Polymarket; 2,666 markets disputed; 323 disputed twice or more and sent to a UMA vote; 853 of 2,543 settled disputed markets (33.5%) settled differently from the disputed proposal; 1 Jan to 2 Oct 2026 | `context` block of `GET api.predge.io/v1/settlement-risk/1137824`, read 9 Oct 2026 (`evidence/settlement-risk-1137824.json`); same figures as v2 |
| Montana Grizzlies vs. Idaho Vandals O/U 151.5, Polymarket market 1137824: proposal Under disputed 9 Jan 2026 04:38:50 UTC, one dispute, settled on-chain Over, uma_state settled, risk_level resolved | same record; ed25519 signature checked offline with Node crypto (valid) and `payload` re-canonicalises to `canonical` |
| Signature prefix/suffix `8c5a4c46...67379209`, kid `13fa3d18a369e6c7` | same record (the signature changes on each fetch because `checked_at` changes; this is the saved one) |
| Settlement-risk check is free and signed; paid routes are x402, 0.03 USDC for `/v1/signals/consensus`, accepted on Base · Arc · Solana · Algorand | `api.predge.io` root, read 9 Oct 2026 (same price v2 used) |
| `check_settlement` reverts with `MarketDisputed`; settled + cooling period before release; Solana devnet | predgeAI/predge-solana-guard README |
| Contracts on Solana · Arc · Arbitrum One | v2 spec (guard on Solana devnet; bond/arbiter contracts on Arc and Arbitrum One) |
| @predge_alerts_bot | `api.predge.io` description |
| Lending desk rows (Rate decision, Season MVP), values, LTVs; vault amount; agent decision text; trader dispute/final alerts | product illustrations, labelled as such |

Copy rules held: no em dashes; never "flipped", "edited rules", "payout", "markets settle wrong";
no win rate, edge, PnL, customer or revenue claims; no third-party verification claims;
no ERC-8434 mention; Robinhood Chain not shown.

## Audio

Same track as v2: "Techno" by AtlasAudio (Pixabay Content License), see `../ad-assets/MUSIC-LICENSE.md`.
The mp3 stays in gitignored `../ad-audio/`. Video t=0 = track 0.495 s; drop on beat 32 (14.77 s);
hard stop with a 50 ms fade at 66.46 s as the end card lands.

## Pipeline

```bash
cd ad-v3
node build.mjs            # src/ad.html -> index.html (16:9). Edit src/ad.html, never index.html.
npx hyperframes check     # lint + layout + contrast
npx hyperframes snapshot --at 1.5,3.5,...   # stills for review
./render-all.sh 169 sq vt # renders/predge-intro-v3-<ar>.mp4, 2 workers, nice 10
```
