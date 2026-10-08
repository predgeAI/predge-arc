# Predge · "Don't Blink" ad v2 · frame spec

Kinetic-typography ad in the Apple "Don't Blink" style. One self-contained
`ad.html`, rendered frame by frame by `record-ad.mjs`. Everything is our own
pixels: no AI-generated footage, no screen capture, no AI voice.

- **Length:** 69.2 s · **47 frames** · **150 beats @ 130 BPM** (matched to the track).
- **Aspects:** 16:9 1920x1080 (master), 1:1 1080x1080 (X / LinkedIn), 9:16 1080x1920 (Shorts / Reels). Same cut, layout adapts (`?ar=169|sq|vt`).
- **Source:** `ad.html` (CSS/JS, all screens, all copy).
- **v1** (45.7 s, 39 frames, 125 BPM, YouTube xy8P-JVHH8Y) is in git history before this commit.
- **Repo:** `predgeAI/predge-arc` (push with `GH_TOKEN=$(gh auth token --user predge-ai)`).

## What changed from v1

- New lead: Settlement Risk ("resolved is not final") with the verified UMA dispute numbers.
- New surfaces: app.predge.io terminal (live stats, hot markets, live feed), sign-in options, the signed settlement-risk record for market 1484949 and its offline check, Circle wallet x402, bonded arbiter, Solana Settlement Guard, ERC-8004 validator, open-source repos, ERC-8434, Circle Arc cohort.
- Removed: the checker card with win-rate and edge; the `15,700,000 signals` count-up; "We stake on our own calls" / "Wrong? You're refunded" (live bonds are 0 today; we say "Verdicts backed by a bond you can challenge"); v1 copy with em dashes.
- Copy rules held: no em dashes on screen; never "flipped", "edited rules", "payout", "markets settle wrong"; no customer or revenue claims.
- Rendering: real-time `recordVideo` replaced with a deterministic seek (`window.__seek(t)`) + screenshot per frame piped to ffmpeg at exactly 30 fps.

---

## Frame-by-frame (130 BPM; 1 beat = 0.4615 s)

Legend: `▸` text card, `▪` product-screen mockup, **bold** = amber accent.

### ACT 1 · Hook: resolved is not final (0.00–14.77 s, the track's intro)
| # | t | b | frame | source |
|---|---|---|---|---|
| 1 | 0.00 | 2 | ▸ "A market resolves." | |
| 2 | 0.92 | 2 | ▸ "Someone disputes it." | |
| 3 | 1.85 | 4 | ▸ "Resolved **is not final.**" | |
| 4 | 3.69 | 3 | ▸ `3,005` count-up · UMA disputes on Polymarket | settlement-risk verify 04.10 (RECOMPUTE.md); `context` block of api.predge.io/v1/settlement-risk |
| 5 | 5.08 | 3 | ▸ `2,666` · markets disputed | same |
| 6 | 6.46 | 3 | ▸ `323` · disputed twice or more, and sent to a UMA vote | same |
| 7 | 7.85 | 4 | ▸ **`33.5%`** · 853 of 2,543 settled disputed markets settled differently from the disputed proposal | same |
| 8 | 9.69 | 3 | ▸ "1 Jan to 2 Oct 2026" · read on-chain · UMA Optimistic Oracle · Polygon | same |
| 9 | 11.08 | 4 | ▸ "Predge **Settlement Risk.**" · signed records of UMA disputes on Polymarket | |
| 10 | 12.92 | 4 | ▸ "Know when an outcome is **actually final.**" | predge-solana-guard README tagline |

### ACT 2 · Breadth (14.77–29.54 s, from the drop; white flash on frame 11)
| # | t | b | frame | source |
|---|---|---|---|---|
| 11 | 14.77 | 2 | ▸ [Polymarket glyph] Polymarket | |
| 12 | 15.69 | 2 | ▸ [Kalshi glyph] Kalshi | api.predge.io Kalshi routes |
| 13 | 16.62 | 2 | ▸ Sports. + 4 generic sport glyphs | `/v1/sports/attest` route |
| 14 | 17.54 | 4 | ▪ **appScreen**: app.predge.io dashboard · Trades 24h 785,300 · Volume 24h $43.75M · Active whales 83,817 · Markets tracked 1,992,707 · Hot markets 24h (3 real rows) | app.predge.io, read 9 Oct 2026 (API snapshot 8 Oct: 783,623 / $43.76M / 83,659 / 1,991,893) |
| 15 | 19.38 | 4 | ▪ **feedScreen**: live whale feed, 4 real rows (aliases as shown in the app) | app.predge.io live feed, 9 Oct 2026 |
| 16 | 21.23 | 2 | ▸ `2M+` · wallets tracked | predge.io homepage |
| 17 | 22.15 | 2 | ▸ `1.9M+` · markets indexed | predge.io homepage; /api/stats/global `markets_active` 1,991,893 |
| 18 | 23.08 | 2 | ▸ `785,300` · trades in 24h · app.predge.io, 9 Oct 2026 | app.predge.io dashboard (dated snapshot) |
| 19 | 24.00 | 3 | ▪ **signinScreen**: Google · Email · Telegram · X · Discord · Farcaster · Passkey · Wallet | app.predge.io sign-in card |
| 20 | 25.38 | 2 | ▸ "Traders get **alerts.**" | |
| 21 | 26.31 | 4 | ▪ **tgScreen**: @predge_alerts_bot · watch wallet → it just moved ($23,900) | bot handle from api.predge.io description |
| 22 | 28.15 | 3 | ▸ "Free on Telegram." · Pro · $20 a month · no delay | predge.io pricing |

### ACT 3 · Proof (29.54–43.38 s)
| # | t | b | frame | source |
|---|---|---|---|---|
| 23 | 29.54 | 2 | ▸ "Don't take" | |
| 24 | 30.46 | 2 | ▸ **"our word for it."** | |
| 25 | 31.38 | 6 | ▪ **srScreen**: signed record, market 1484949 "Netanyahu out by March 31?" · disputes 2 · UMA vote yes · UMA state settled · on-chain No · dispute times · kid 13fa3d18a369e6c7 · sig prefix/suffix | GET api.predge.io/v1/settlement-risk/1484949, checked 8 Oct 2026 |
| 26 | 34.15 | 2 | ▸ `ed25519` · signed by predge.io | |
| 27 | 35.08 | 5 | ▪ **verifyScreen**: re-canonicalize (keys sorted, no whitespace) → ed25519 VALID, no network | we ran this check on that exact record with Node crypto: signature valid |
| 28 | 37.38 | 3 | ▸ **"Verifiable offline."** | |
| 29 | 38.77 | 3 | ▸ "A published canonicalization spec." | `verify` field of every record; x402-receipts spec |
| 30 | 40.15 | 4 | ▸ "Independently verified by **FairSeal.**" | owner brief (not re-checked here) |
| 31 | 42.00 | 3 | ▸ "Every chain fact, re-checkable on any Polygon RPC." | `data_basis` of the record |

### ACT 4 · Agents (43.38–52.62 s)
| # | t | b | frame | source |
|---|---|---|---|---|
| 32 | 43.38 | 2 | ▸ "Agents get an **API.**" | |
| 33 | 44.31 | 5 | ▪ **termScreen**: GET /v1/signals/consensus → 402 · accepts Base · Arc · Solana · Algorand · 0.03 USDC → pay on Arc → 200 signed JSON, payment bound into the signed record | api.predge.io root (`networks`, prices); record `verify` text on `payload.payment` |
| 34 | 46.62 | 3 | ▸ "Pay per call in USDC. No account. No API key." | |
| 35 | 48.00 | 3 | ▸ **`27`** · paid routes · Base · Arc · Solana · Algorand | api.predge.io root: 29 routes, 2 free |
| 36 | 49.38 | 4 | ▪ **circleScreen**: Circle developer-controlled wallet, agent holds no key and no gas, 402 → sign via Circle API → 200 | predgeAI/circle-wallet-x402 |
| 37 | 51.23 | 3 | ▸ "Open source." · predgeAI/x402-receipts · predgeAI/circle-wallet-x402 | public GitHub repos |

### ACT 5 · Enforcement (52.62–63.23 s)
| # | t | b | frame | source |
|---|---|---|---|---|
| 38 | 52.62 | 2 | ▸ "Verdicts backed by a bond" | |
| 39 | 53.54 | 2 | ▸ **"you can challenge."** | |
| 40 | 54.46 | 5 | ▪ **arbiterScreen**: Arc mainnet · Arbitrum One · Robinhood Chain · 24h dispute window from the verdict · challenge with evidence → arbiter rules · wrong verdict → bond slashed | contract deploys (03.10 audit); bond on Arbitrum One has code on chain |
| 41 | 56.77 | 4 | ▪ **guardScreen**: Solana devnet · vault.release → check_settlement → `MarketEscalated`, funds locked → after final + cooling → released | predgeAI/predge-solana-guard README (error names are real) |
| 42 | 58.62 | 4 | ▪ **validatorScreen**: ERC-8004 outcome validator · Monad testnet · 145 verdicts · slash demo | owner brief (145); erc8004-outcome-validator README (24h window, slashable) |
| 43 | 60.46 | 3 | ▸ "Our fields, added to the **ERC-8434** draft." | owner brief |
| 44 | 61.85 | 3 | ▸ "Circle **Arc** accelerator cohort." · Demo Day · 9 Nov 2026 | owner brief |

### ACT 6 · Close (63.23–69.23 s)
| # | t | b | frame |
|---|---|---|---|
| 45 | 63.23 | 4 | ▸ **chainsBand**: "Settling and enforcing on" Arc · Base · Solana + Arbitrum One · Robinhood Chain · Algorand · Monad testnet |
| 46 | 65.08 | 3 | ▸ **"Verify, don't trust."** |
| 47 | 66.46 | 6 | ▸ **logoClose**: PREDGE. wordmark (SVG) · "Verify, don't trust." · predge.io · app.predge.io · @PredgeAI. Music hard-cuts here; ~2.8 s hold in silence. |

Section starts sit on the track's phrase changes: drop at beat 32, phrases at 64 and 96.

---

## Logos

- **Wordmark:** always `ad-assets/predge-wordmark.svg` (Syne ExtraBold outlined). Never retype it.
- **Official SVGs** in `ad-assets/logos/`: Solana (used), Polygon, Bitcoin.
- **Rebuilt inline:** Base, Arc, Polymarket, Kalshi (as v1). Arbitrum, Robinhood Chain, Algorand, Monad appear as text only.
- **Sport emblems:** generic glyphs, no league trademarks.

## Audio

- **"Techno" by AtlasAudio** (Pixabay), 130 BPM, Pixabay Content License, no Content ID badge. Details and hash: `ad-assets/MUSIC-LICENSE.md`.
- File: `ad-audio/atlasaudio-techno-606278.mp3` (gitignored: the license does not allow redistributing the audio by itself).
- Sync: video t=0 = track 0.495 s (track beat 1). Track drop (beat 33) lands on video beat 32 = 14.77 s.
- **Punch ending:** music hard-stops (50 ms fade) at 66.46 s, exactly as the logo cuts in.
- No voice, no sound effects (the v1 Telegram ding is not used).

## Pipeline

```bash
cd predge-arc
node record-ad.mjs 169            # → rec/ad-169.mp4 (silent, 1920x1080, 30 fps)
node record-ad.mjs sq             # → rec/ad-sq.mp4  (1080x1080)
node record-ad.mjs vt             # → rec/ad-vt.mp4  (1080x1920)
node record-ad.mjs 169 grid       # → rec/grid-169/NN.png, one still per cut, for review
# mux (same for each aspect):
ffmpeg -y -i rec/ad-169.mp4 -ss 0.495 -i ad-audio/atlasaudio-techno-606278.mp3 \
  -filter_complex "[1:a]atrim=0:66.46,afade=t=out:st=66.41:d=0.05,apad,alimiter=limit=0.97[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart predge-intro-v2.mp4
```

Run heavy renders with `taskpolicy -b nice -n 10` (the recorder already caps ffmpeg at 3 threads).
Env overrides: `PLAYWRIGHT` (path to playwright `index.js`), `CHROME` (browser executable).

## How to edit

- **Copy / order / add a frame:** the `FRAMES` array in `ad.html`: `{ b:<beats>, ...T('type'|'screen', <html>) }`.
- **Tempo:** `const BPM`. If you change the track, re-measure BPM and the downbeat offset and move the drop.
- **Count-ups:** `data-count` (+ `data-dec`, `data-prefix`, `data-suffix`); value is a function of time, so seeks are exact.
- **Terminal lines:** wrap each in `L(i, html)`; line i appears at i × 0.32 s.
- **Stats** are dated snapshots. Before re-rendering, re-read https://predge.io/api/stats/global and app.predge.io and update frames 14 and 18.

## Guardrails

- Push only to `predgeAI`; commit author = Predge noreply (predge-ai). No AI attribution anywhere.
- Never commit audio files (`ad-audio/` is gitignored).
- Mockups carry no personal data: wallet aliases only, no addresses of people, no emails.
- On-screen copy: no em dashes; no win-rate or edge claims; no "flipped", "edited rules", "payout", "markets settle wrong"; no customer or revenue claims.
