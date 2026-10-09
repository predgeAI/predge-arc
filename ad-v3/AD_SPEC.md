# Predge intro v3 · spec (revision 3: beat-cut)

Kinetic, beat-cut product ad in the "Don't Blink" grammar: hard cuts on the beat, one or two words
per frame, product UI shown as rapid punch-ins. Light canvas and amber accent, dark mesh for the
intro, the break and the close. Cut to Surkin "Tiger Rhythm" (the original "Don't Blink" track).

- **Length:** 61.68 s · 128.5 beats @ 125 BPM · **121 shots, average 0.51 s**; longest shot 3 beats except the end card (4.5).
- **Cut grammar:** every shot starts with a hard cut on a beat (or a half-beat on the two drops, the
  numbers and the recap); inside a shot only snaps: word slams, punch-ins, 0.24 s count-ups.
  Whips (12 px blur, 6% travel) on bar lines; 2-frame flashes on drop 1, drop 2 and the final section.
  Cut times are snapped to the frame they must appear on.
- **Aspects:** 1920x1080 master, 1080x1080, 1080x1920 (`node build.mjs 169|sq|vt`). UI punch-ins are
  framed by script per aspect (crop window around the focused element), so phone-size text stays large.
- **Engine:** HyperFrames 0.8.143 composition (`index.html`, one paused GSAP timeline, seek-safe),
  rendered with `npx hyperframes render`; audio muxed with ffmpeg (`render-all.sh`).
- **Pixels:** all our own (HTML/CSS/SVG). No AI images or video, no screen capture, no stock photos.
- **Personas are generic** ("a lending desk", "an agent", "a vault", "a trader"); persona UI shots carry
  "Product illustration". The trader section is labelled **Coming soon**: @predge_alerts_bot sends
  whale-trade and watched-wallet alerts today, not dispute or settlement alerts.
  No customer, revenue, win-rate or edge claims.

## Shot list (beats; 1 beat = 0.48 s; video t=0 = track 0.27 s)

The source of truth is the `S` array in `src/ad.html`. Sections:

| beats | time (s) | section | shots |
|---|---|---|---|
| 0–8 | 0.00–3.84 | intro: wordmark; "Know / when an outcome / is actually / final."; wordmark + "Settlement risk for prediction markets." | 6 |
| 8–28 | 3.84–13.44 | **drop 1**: "A market / resolves." (half-beats), card, proposal punch-in, "Someone / disputes it.", DISPUTED stamp, disputed row, "Resolved / is not / final." (amber), settled Over, "Predge reads the dispute on-chain.", pipeline in 4 shots, "Signed." "Re-checkable on any Polygon RPC." "Verifiable offline." | 23 |
| 28–32 | 13.44–15.36 | break: "How / often / does this / happen?" (dark) | 4 |
| 32–44 | 15.36–21.12 | **drop 2**: 3,005 UMA disputes on Polymarket · 2,666 markets disputed · 323 disputed twice or more and sent to a UMA vote · 853 of 2,543 settled disputed markets settled differently from the disputed proposal · 33.5% · 1 Jan to 2 Oct 2026 (half-beat snaps, 0.24 s counts) | 13 |
| 44–56 | 21.12–26.88 | a lending desk: persona, "Price / the risk / before it settles.", desk, risk toast, Disputed chip, LTV 60% to 0%, borrowing power $57,610 to $28,690, record popover, "Automatically." | 11 |
| 56–70 | 26.88–33.60 | an agent: persona, "Pays / per call.", return keycap, 402 · 0.03 USDC, x402 pay on Arc, 200 signed, "No account. / No API key.", free settlement check, risk_level resolved, verify valid, decision | 13 |
| 70–83 | 33.60–39.84 | a vault: persona, "Funds wait / for final.", Release, Blocked: MarketDisputed, reverted log, Settled, Cooling, Final, Released, "Contracts on Solana · Arc · Arbitrum One" | 12 |
| 83–96 | 39.84–46.08 | a trader (coming soon): persona + Coming soon, "Know / before it / costs you.", lock-screen alert, alert punch-in, chat, Open record, signed record, Final: Over, "Coming soon to @predge_alerts_bot" | 11 |
| 96–108 | 46.08–51.84 | final section, proof: "Every / answer / is signed.", record, Under/Over fields, signature, "Verify, / don't trust.", canonical, ed25519 valid, no network, Valid | 12 |
| 108–118 | 51.84–56.64 | "One signed answer: / is it final?", hub tiles one per beat, hub glow, recap "Lending desks. Agents. Vaults. Traders." (half-beats) | 11 |
| 118–124 | 56.64–59.52 | close: "Know / when an outcome / is actually / final." (dark) | 4 |
| 124–128.5 | 59.52–61.68 | end card on the last hit: wordmark, predge.io · app.predge.io · @PredgeAI | 1 |

## Checks

- `edgecheck.mjs`: every frame of all three aspects, no visible text crosses the frame edge (text
  inside a crop window is skipped; the window is always inside the frame). Word slams cap their
  overshoot so the scaled word never leaves the frame.
- `sync-check.py`: measures the beat grid from the audio of the rendered file (onset peaks, least
  squares) and the cut times by ffmpeg scene detection. Revision 3, 16:9: audio 125.08 BPM;
  95 detected cuts; median cut offset to the nearest half-beat 11.5 ms (p90 29 ms), 91/95 within one
  frame. 1:1 and 9:16 give the same picture (median 10 to 12 ms).

## On-screen claims and sources

| Claim | Source |
|---|---|
| 3,005 UMA disputes on Polymarket; 2,666 markets disputed; 323 disputed twice or more and sent to a UMA vote; 853 of 2,543 settled disputed markets (33.5%) settled differently from the disputed proposal; 1 Jan to 2 Oct 2026 | `context` block of `GET api.predge.io/v1/settlement-risk/1137824`, read 9 Oct 2026 (`evidence/settlement-risk-1137824.json`); same figures as v2 |
| Montana Grizzlies vs. Idaho Vandals O/U 151.5, Polymarket market 1137824: proposal Under disputed 9 Jan 2026 04:38:50 UTC, one dispute, settled on-chain Over, uma_state settled, risk_level resolved | same record; ed25519 signature checked offline with Node crypto (valid) and `payload` re-canonicalises to `canonical` |
| Trader scene (Coming soon) | `apps/bot` in predgeAI/predge (main, 8 Oct 2026): whale-trade alerts, wallet watchlist and digests only; no dispute or settlement alerts yet |
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

Surkin "Tiger Rhythm", used with the artist's written permission to Predge; see
`../ad-assets/MUSIC-LICENSE.md`. The mp3 stays in gitignored `../ad-audio/`. Measured 125.0 BPM,
first downbeat at track 0.27 s (video t=0). Drop 1 on beat 8 (video 3.84 s), drop 2 on beat 32
(video 15.36 s, numbers scene), last hit on beat 124 (59.52 s, end card), then the track's own
decay with a 0.3 s tail fade at 61.68 s.

## Pipeline

```bash
cd ad-v3
node build.mjs            # src/ad.html -> index.html (16:9). Edit src/ad.html, never index.html.
npx hyperframes check     # lint + layout + contrast
node edgecheck.mjs $PWD/index.html 1920 1080   # every frame: no text across the frame edge
python3 sync-check.py renders/predge-intro-v3-169.mp4   # cut-to-beat offsets from the render
npx hyperframes snapshot --at 1.5,3.5,...   # stills for review
./render-all.sh 169 sq vt # renders/predge-intro-v3-<ar>.mp4, 2 workers, nice 10
```
