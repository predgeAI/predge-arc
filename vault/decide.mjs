// DECIDE — the vault's entire trading brain, small enough to read on one screen
// and unit-test exhaustively. Pure function: consensus payload + current posture
// + thresholds in, target posture out. No I/O, no randomness. Ported from the
// predge-keeperhub-agent decision rule and mapped onto vault postures.
//
// Rule (documented here exactly as implemented):
//
//   market  = WATCH_MARKET if set, else the top market in the consensus
//   net     = market.net_flow_usd   (smart YES volume minus smart NO volume)
//   wallets = market.smart_wallets  (distinct wallets above the score floor)
//
//   FLAT  if consensus.insufficient_data
//   FLAT  if no market present
//   FLAT  if wallets < MIN_SMART_WALLETS            (too few independent whales)
//   LONG  if direction == "yes" and net >= +FLOW_MIN_USD
//   SHORT if direction == "no"  and net <= -FLOW_MIN_USD
//   FLAT  otherwise                                 (split or weak flow)
//
//   A rebalance tx happens only when the target posture DIFFERS from the vault's
//   current on-chain posture — the agent trades direction flips, not every poll.

export const POSTURE = { SHORT: -1, FLAT: 0, LONG: 1 };
export const POSTURE_NAME = { "-1": "SHORT", 0: "FLAT", 1: "LONG" };

export function selectMarket(consensus, { watchMarket } = {}) {
  const markets = consensus?.markets ?? [];
  if (watchMarket && watchMarket !== "top") {
    return { market: markets.find((m) => m.condition_id === watchMarket) ?? null, how: "env:WATCH_MARKET" };
  }
  return { market: markets[0] ?? null, how: "top-by-smart-volume" };
}

/**
 * @param consensus signed consensus payload (the attestation's `payload`)
 * @param currentPosture int8 currently stored on-chain (-1 | 0 | 1)
 * @param cfg { flowMinUsd, minSmartWallets, watchMarket }
 * @returns { target, targetName, direction, action, reason, market, thresholds, current }
 */
export function decide(consensus, currentPosture, cfg) {
  const { market, how } = selectMarket(consensus, { watchMarket: cfg.watchMarket });
  const current = Number(currentPosture ?? 0);
  const base = {
    current,
    currentName: POSTURE_NAME[String(current)] ?? "FLAT",
    market,
    market_selected_by: how,
    thresholds: { flow_min_usd: cfg.flowMinUsd, min_smart_wallets: cfg.minSmartWallets },
  };

  const flat = (reason) => finish(base, POSTURE.FLAT, reason);

  if (consensus?.insufficient_data) return flat(`consensus has no data: ${consensus.reason ?? "insufficient_data"}`);
  if (!market) return flat("watched market not present in this consensus window");
  if (Number(market.smart_wallets) < cfg.minSmartWallets) {
    return flat(`only ${market.smart_wallets} smart wallet(s) behind the flow, need >= ${cfg.minSmartWallets}`);
  }

  const net = Number(market.net_flow_usd);
  let target = POSTURE.FLAT;
  if (market.direction === "yes" && net >= cfg.flowMinUsd) target = POSTURE.LONG;
  else if (market.direction === "no" && net <= -cfg.flowMinUsd) target = POSTURE.SHORT;

  if (target === POSTURE.FLAT) {
    return flat(
      `no decisive signal: direction=${market.direction}, net flow $${Math.round(net)} ` +
        `(need |net| >= $${cfg.flowMinUsd} with a yes/no direction)`,
    );
  }
  return finish(
    base,
    target,
    `${market.smart_wallets} smart wallets moved net $${Math.round(net)} ${String(market.direction).toUpperCase()} ` +
      `on "${market.title ?? market.condition_id}"`,
  );
}

function finish(base, target, reason) {
  const action = target === base.current ? "HOLD" : "REBALANCE";
  return {
    ...base,
    target,
    targetName: POSTURE_NAME[String(target)],
    direction: target,
    action,
    reason:
      action === "HOLD"
        ? `already ${POSTURE_NAME[String(target)]} — ${reason}`
        : `flip ${base.currentName} -> ${POSTURE_NAME[String(target)]}: ${reason}`,
  };
}
