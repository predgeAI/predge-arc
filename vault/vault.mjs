// Arc plumbing for PredgeSignalVault: ABI, a keccak256 signal-hash helper, a
// compact attestation-reference builder, and thin deposit / rebalance / read
// wrappers. Reuses lib/arc.mjs (rate-limit-tolerant provider + retry).
import { Contract, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { DEFAULT_RPC, fmtUsdc, makeProvider, txLink, withRetry } from "../lib/arc.mjs";
import { config } from "./config.mjs";

// Human-readable ABI of contracts/PredgeSignalVault.sol.
export const VAULT_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function rebalance(bytes32 signalHash, int8 direction, string attestationRef) external",
  "function setKeeper(address newKeeper) external",
  "function setPaused(bool p) external",
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function paused() view returns (bool)",
  "function posture() view returns (int8)",
  "function rebalanceCount() view returns (uint64)",
  "function totalDeposits() view returns (uint256)",
  "function lastSignalHash() view returns (bytes32)",
  "function lastAttestationRef() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function state() view returns (int8 posture_, uint64 rebalanceCount_, uint256 totalDeposits_, bool paused_, bytes32 lastSignalHash_, string lastAttestationRef_)",
  "event Deposited(address indexed account, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed account, uint256 amount, uint256 newBalance)",
  "event Rebalanced(uint64 indexed seq, int8 oldPosture, int8 newPosture, uint16 targetExposureBps, bytes32 indexed signalHash, string attestationRef, address indexed keeper, uint256 timestamp)",
];

export function provider() {
  return makeProvider(config.arcRpc || DEFAULT_RPC);
}

export function vaultRead(address = config.vaultAddress) {
  if (!address) throw new Error("no vault address — set VAULT_ADDRESS or deploy with `npm run deploy-vault`");
  return new Contract(address, VAULT_ABI, provider());
}

export function vaultWith(privateKey, address = config.vaultAddress) {
  if (!address) throw new Error("no vault address — set VAULT_ADDRESS or deploy with `npm run deploy-vault`");
  if (!privateKey) throw new Error("no signer key available in .env");
  return new Contract(address, VAULT_ABI, new Wallet(privateKey, provider()));
}

/** keccak256 of the EXACT signed bytes — commits on-chain to what was verified. */
export function signalHashFromCanonical(canonical) {
  return keccak256(toUtf8Bytes(canonical));
}

/** Compact, auditor-usable reference to the off-chain attestation. */
export function attestationRef(att, { demo = false, kid = null } = {}) {
  const sigHead = String(att.signature).slice(0, 16);
  const pubHead = String(att.public_key).slice(0, 16);
  if (demo) {
    return `SAMPLE self-signed ed25519 pub=${pubHead}… sig=${sigHead}… (NOT the live Predge key)`;
  }
  return (
    `${att.version ?? "predge-attest-v1"} ed25519 kid=${kid ?? "?"} sig=${sigHead}… ` +
    `verify=${config.predgeBaseUrl}/.well-known/predge-keys.json`
  );
}

export async function readState(address = config.vaultAddress) {
  const v = vaultRead(address);
  const s = await withRetry("state", () => v.state());
  return {
    address,
    posture: Number(s[0]),
    rebalanceCount: Number(s[1]),
    totalDeposits: s[2],
    totalDepositsUsdc: fmtUsdc(s[2]),
    paused: s[3],
    lastSignalHash: s[4],
    lastAttestationRef: s[5],
  };
}

export async function deposit(usdcAmountWei, { key = config.depositorKey, address = config.vaultAddress } = {}) {
  const v = vaultWith(key, address);
  const tx = await withRetry("deposit", () => v.deposit({ value: usdcAmountWei }));
  const rc = await withRetry("deposit.wait", () => tx.wait());
  return { hash: tx.hash, block: rc.blockNumber, link: txLink(tx.hash) };
}

export async function rebalance(signalHash, direction, ref, { key = config.keeperKey, address = config.vaultAddress } = {}) {
  const v = vaultWith(key, address);
  const tx = await withRetry("rebalance", () => v.rebalance(signalHash, direction, ref));
  const rc = await withRetry("rebalance.wait", () => tx.wait());
  return { hash: tx.hash, block: rc.blockNumber, link: txLink(tx.hash) };
}
