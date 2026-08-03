// Frozen SAMPLE smart-money consensus payloads, in the EXACT production shape of
// GET /v1/signals/consensus (see the live route + predge-keeperhub-agent
// fixtures). Used only when no live Base buyer key is present: the vault-keeper
// self-signs one of these with an ephemeral ed25519 key and clearly labels it
// as a sample — NOT the live Predge signing key. The verification path exercised
// is identical to the live one.

export const SAMPLE_CONSENSUS = {
  // Net smart-money flow strongly YES -> vault should go LONG.
  riskon: {
    window_hours: 24,
    smart_score_min: 60,
    scored_wallets_total: 412,
    insufficient_data: false,
    issued_at: "2026-08-02T14:20:00.000Z",
    markets: [
      {
        condition_id: "0x178a2b41ec1b1e6b8f5f04dc09c2cf9b17ffbe9e2e21ef6df171e5efc0a981c3",
        platform: "polymarket",
        title: "Fed cuts rates at the September meeting?",
        category: "economy",
        market_yes_price: 0.58,
        smart_wallets: 7,
        smart_yes_usd: 26400,
        smart_no_usd: 7900,
        net_flow_usd: 18500,
        direction: "yes",
      },
      {
        condition_id: "0x9c11f7f52ab5da213a2a2e07e2536ce52a1e39acdd51f2f6c9dfc4a09e2f4bd0",
        platform: "polymarket",
        title: "Bitcoin above $150k on Dec 31?",
        category: "crypto",
        market_yes_price: 0.34,
        smart_wallets: 5,
        smart_yes_usd: 9100,
        smart_no_usd: 8600,
        net_flow_usd: 500,
        direction: "split",
      },
    ],
  },

  // Net smart-money flow strongly NO -> vault should go SHORT.
  riskoff: {
    window_hours: 24,
    smart_score_min: 60,
    scored_wallets_total: 388,
    insufficient_data: false,
    issued_at: "2026-08-02T14:20:00.000Z",
    markets: [
      {
        condition_id: "0x33d4be0f4c1a2a90ce2f8f0a91adad76c50a8b2e18e9c25a2a1c3fd15f7a5c22",
        platform: "polymarket",
        title: "US recession declared in 2026?",
        category: "economy",
        market_yes_price: 0.22,
        smart_wallets: 6,
        smart_yes_usd: 3100,
        smart_no_usd: 21400,
        net_flow_usd: -18300,
        direction: "no",
      },
    ],
  },

  // Weak / split flow -> vault should stay FLAT.
  neutral: {
    window_hours: 24,
    smart_score_min: 60,
    scored_wallets_total: 401,
    insufficient_data: false,
    issued_at: "2026-08-02T14:20:00.000Z",
    markets: [
      {
        condition_id: "0x9c11f7f52ab5da213a2a2e07e2536ce52a1e39acdd51f2f6c9dfc4a09e2f4bd0",
        platform: "polymarket",
        title: "Bitcoin above $150k on Dec 31?",
        category: "crypto",
        market_yes_price: 0.5,
        smart_wallets: 4,
        smart_yes_usd: 5200,
        smart_no_usd: 4900,
        net_flow_usd: 300,
        direction: "split",
      },
    ],
  },
};

export const SAMPLE_ALIASES = Object.keys(SAMPLE_CONSENSUS);
