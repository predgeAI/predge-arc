// Compile PredgeSettlement.sol (solc) and deploy it to Circle Arc testnet,
// then send one real settlement tx so the contract is verifiably live.
import { readFileSync, existsSync } from "node:fs";
import solc from "solc";
import {
  JsonRpcProvider,
  Network,
  Wallet,
  ContractFactory,
  keccak256,
  toUtf8Bytes,
} from "ethers";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public Arc RPC rate-limits (-32011 "request limit reached"); retry transient.
async function withRetry(label, fn, tries = 8) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e && (e.error?.message || e.shortMessage || e.message)) || "";
      const transient =
        /request limit|rate|-32011|timeout|coalesce|failed to detect network/i.test(msg);
      lastErr = e;
      if (!transient) throw e;
      const wait = 1500 * (i + 1);
      console.log(`  (${label}) rate-limited, retry ${i + 1}/${tries} in ${wait}ms…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

const ENV = new URL("../.env", import.meta.url).pathname;
const SOL = new URL("../contracts/PredgeSettlement.sol", import.meta.url).pathname;
const EXPLORER = "https://testnet.arcscan.app";

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = parseEnv(ENV);
const RPC = env.ARC_RPC || "https://rpc.testnet.arc.io";
const PK = env.PRIVATE_KEY;
if (!PK) {
  console.error("No PRIVATE_KEY in .env — run `npm run genwallet` first.");
  process.exit(1);
}

// ---- compile ----
const source = readFileSync(SOL, "utf8");
const input = {
  language: "Solidity",
  sources: { "PredgeSettlement.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const fatal = (out.errors || []).filter((e) => e.severity === "error");
if (fatal.length) {
  console.error("Solc errors:\n" + fatal.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const c = out.contracts["PredgeSettlement.sol"]["PredgeSettlement"];
const abi = c.abi;
const bytecode = "0x" + c.evm.bytecode.object;
console.log("Compiled PredgeSettlement (solc " + solc.version() + ").");

// ---- deploy ----
// staticNetwork = don't auto-detect (skips the eth_chainId storm that trips the
// public RPC's rate limiter).
const ARC_CHAINID = BigInt(env.ARC_CHAINID || "5042002");
const provider = new JsonRpcProvider(RPC, undefined, {
  staticNetwork: Network.from(ARC_CHAINID),
});
const wallet = new Wallet(PK, provider);
const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log("Deployer:", wallet.address);
console.log("Chain:", ARC_CHAINID.toString(), "| native balance:", bal.toString());
if (bal === 0n) {
  console.error("Balance is 0 — fund the deployer at https://faucet.circle.com (Arc Testnet, USDC), then re-run.");
  process.exit(1);
}

const factory = new ContractFactory(abi, bytecode, wallet);
const contract = await withRetry("deploy", () => factory.deploy());
const deployTx = contract.deploymentTransaction();
console.log("Deploy tx:", deployTx.hash);
await withRetry("waitForDeployment", () => contract.waitForDeployment());
const addr = await contract.getAddress();
console.log("\n✅ PredgeSettlement deployed at:", addr);
console.log("   " + EXPLORER + "/address/" + addr);
console.log("   deploy tx: " + EXPLORER + "/tx/" + deployTx.hash);

// ---- one real settlement tx (best-effort; tiny value) ----
try {
  const route = keccak256(toUtf8Bytes("v1/wallets/{address}"));
  const tx = await withRetry("payForRoute", () =>
    contract.payForRoute(route, "arc-first-settlement", { value: 100000n })
  );
  console.log("\nSettlement tx sent:", tx.hash);
  await withRetry("settlement.wait", () => tx.wait());
  console.log("✅ First on-chain settlement confirmed:");
  console.log("   " + EXPLORER + "/tx/" + tx.hash);
} catch (e) {
  console.log("\n(Optional settlement tx skipped: " + (e.shortMessage || e.message) + ")");
  console.log(" Contract is deployed regardless — that's the 'contracts deployed on Arc' fact.");
}

console.log("\nSummary for the Circle form / site:");
console.log("  Live on Arc: YES (testnet)  |  Smart contracts deployed: YES");
console.log("  Contract:", addr);
