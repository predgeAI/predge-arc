// Shared Circle Arc testnet plumbing: chain constants, PredgeSettlement ABI,
// a rate-limit-tolerant provider, and small formatting helpers.
//
// On Arc, USDC is the NATIVE token (18-decimal wei at the RPC level), so
// `msg.value` on payForRoute IS the USDC payment — no ERC-20 approve dance.
import { Contract, JsonRpcProvider, Network, keccak256, toUtf8Bytes } from "ethers";

export const ARC_CHAIN_ID = 5042002n;
export const DEFAULT_RPC = "https://rpc.testnet.arc.io";
export const EXPLORER = "https://testnet.arcscan.app";
export const DEFAULT_CONTRACT = "0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5";

// Human-readable ABI of contracts/PredgeSettlement.sol (deployed, immutable).
export const SETTLEMENT_ABI = [
  "event Paid(address indexed payer, bytes32 indexed route, uint256 amount, uint256 timestamp, string meta)",
  "function payForRoute(bytes32 route, string calldata meta) external payable",
  "function owner() view returns (address)",
  "function withdraw(address payable to) external",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry transient public-RPC failures (Arc's public RPC rate-limits: -32011). */
export async function withRetry(label, fn, tries = 8) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e && (e.error?.message || e.shortMessage || e.message)) || "";
      const transient =
        /request limit|rate|-32011|timeout|coalesce|failed to detect network|ETIMEDOUT|ECONNRESET/i.test(
          msg,
        );
      lastErr = e;
      if (!transient) throw e;
      const wait = 1500 * (i + 1);
      console.error(`  (${label}) transient RPC error, retry ${i + 1}/${tries} in ${wait}ms…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** Provider pinned to Arc's chain id (skips the auto-detect eth_chainId storm). */
export function makeProvider(rpc = DEFAULT_RPC) {
  const provider = new JsonRpcProvider(rpc, undefined, {
    staticNetwork: Network.from(ARC_CHAIN_ID),
  });
  provider.pollingInterval = 2000;
  return provider;
}

export function settlementContract(provider, address = DEFAULT_CONTRACT) {
  return new Contract(address, SETTLEMENT_ABI, provider);
}

/** bytes32 route id — keccak256 over the UTF-8 route string. */
export function routeHash(route) {
  return keccak256(toUtf8Bytes(route));
}

/** Format native-wei (18 decimals) as a USDC amount string. */
export function fmtUsdc(wei) {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
export const addressLink = (addr) => `${EXPLORER}/address/${addr}`;
