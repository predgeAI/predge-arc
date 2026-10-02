// Close out every open validator bond on a live network.
//
// A bond is staked at the moment of a verdict and stays challengeable for
// `disputeWindow` seconds. Once that window closes with no successful challenge,
// the verdict stood and the validator takes its stake back with reclaim().
// This script reads the live-loop receipts, checks each stake on-chain, and only
// sends reclaim() for the ones the contract will actually accept.
//
//   node script/reclaim-bonds.mjs arc-mainnet
//   node script/reclaim-bonds.mjs rh-mainnet | arbitrum-one
//
// Receipts are written next to the loop receipts as reclaim-<timestamp>.json.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { JsonRpcProvider, Network, Wallet, Contract, formatEther } from "ethers";

const NETWORKS = {
  "arc-mainnet": {
    label: "Arc mainnet", chainId: 5042n, unit: "USDC",
    rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io",
    repo: "/Users/amir/Documents/Playground/predge-arc", dir: "deployments/arc-mainnet",
  },
  "rh-mainnet": {
    label: "Robinhood Chain mainnet", chainId: 4663n, unit: "ETH",
    rpc: "https://rpc.mainnet.chain.robinhood.com/rpc",
    explorer: "https://explorer.mainnet.chain.robinhood.com",
    repo: "/Users/amir/Documents/Playground/predge-robinhood", dir: "deploy/rh-mainnet",
  },
  "arbitrum-one": {
    label: "Arbitrum One", chainId: 42161n, unit: "ETH",
    rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io",
    repo: "/Users/amir/Documents/Playground/predge-robinhood", dir: "deploy/arbitrum-one",
  },
};

// Two shapes of the same getter: bonds deployed before the job-bound challenge fix have no
// jobId in the stake, so decoding falls back to the shorter tuple.
const STAKE_WITH_JOB = "function stakes(bytes32) view returns (bytes32 expected, uint96 bond, uint64 stakedAt, uint8 score, bool scored, bool closed, uint256 jobId)";
const STAKE_LEGACY = "function stakes(bytes32) view returns (bytes32 expected, uint96 bond, uint64 stakedAt, uint8 score, bool scored, bool closed)";
const BOND_ABI = [
  STAKE_WITH_JOB,
  "function disputeWindow() view returns (uint64)",
  "function validator() view returns (address)",
  "function reclaim(bytes32 requestHash)",
];

const key = process.argv[2];
const NET = NETWORKS[key];
if (!NET) throw new Error(`usage: node script/reclaim-bonds.mjs <${Object.keys(NETWORKS).join("|")}>`);

// PRIVATE_KEY lives in each repo's own .env, never in the repo itself.
function envFile(repo) {
  const out = {};
  const p = `${repo}/.env`;
  if (existsSync(p)) for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const base = `${NET.repo}/${NET.dir}`;
const e = { ...envFile(NET.repo), ...process.env };
const bondAddress = JSON.parse(readFileSync(`${base}/PredgeValidatorBond.json`, "utf8")).address;

const provider = new JsonRpcProvider(NET.rpc, undefined, { staticNetwork: Network.from(NET.chainId) });
const wallet = new Wallet(e.PRIVATE_KEY, provider);
const bond = new Contract(bondAddress, BOND_ABI, wallet);

// Every requestHash this repo has ever staked on this network.
const hashes = [...new Set(readdirSync(base)
  .filter((f) => f.startsWith("live-loop-") && f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${base}/${f}`, "utf8")).requestHash)
  .filter(Boolean))];

const window = await bond.disputeWindow();
const validator = await bond.validator();
const now = Math.floor(Date.now() / 1000);

console.log(`\n=== reclaim bonds on ${NET.label} ===`);
console.log(`bond ${bondAddress} | disputeWindow ${window}s | validator ${validator}`);
console.log(`operator ${wallet.address} | balance ${formatEther(await provider.getBalance(wallet.address))} ${NET.unit}`);
if (validator.toLowerCase() !== wallet.address.toLowerCase())
  throw new Error(`operator is not the validator; reclaim() would revert`);

const legacy = new Contract(bondAddress, [STAKE_LEGACY], wallet);
const stakeOf = async (h) => {
  try {
    return await bond.stakes(h);
  } catch {
    return await legacy.stakes(h);
  }
};

const done = [];
for (const h of hashes) {
  const s = await stakeOf(h);
  const opensAt = Number(s.stakedAt) + Number(window);
  if (s.stakedAt === 0n) { console.log(`  ${h.slice(0, 18)}… not committed, skip`); continue; }
  if (s.closed) { console.log(`  ${h.slice(0, 18)}… already closed, skip`); continue; }
  if (!s.scored) { console.log(`  ${h.slice(0, 18)}… no verdict recorded, skip`); continue; }
  if (now < opensAt) {
    console.log(`  ${h.slice(0, 18)}… window open for another ${opensAt - now}s, skip`);
    continue;
  }
  process.stdout.write(`  ${h.slice(0, 18)}… reclaiming ${formatEther(s.bond)} ${NET.unit} … `);
  const tx = await bond.reclaim(h);
  const rc = await tx.wait();
  console.log(`status ${rc.status} ${NET.explorer}/tx/${tx.hash}`);
  done.push({ requestHash: h, bond: formatEther(s.bond), tx: tx.hash, status: rc.status });
}

console.log(`\nreclaimed ${done.length}/${hashes.length} | balance now ${formatEther(await provider.getBalance(wallet.address))} ${NET.unit}`);
if (done.length) {
  const out = `${base}/reclaim-${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ network: key, chainId: Number(NET.chainId), bond: bondAddress, at: new Date().toISOString(), reclaimed: done }, null, 2));
  console.log(`receipts -> ${out}`);
}
