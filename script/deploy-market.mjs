// Compile contracts/ExampleMarket.sol (solc 0.8.26, optimizer 200 — same
// settings as PredgeOracle / PredgeSettlement / PredgeSignalVault) and deploy a
// single binary market to Circle Arc testnet, bound to a marketId the oracle has
// ALREADY pre-committed. Writes market/deployment.json.
// Mirrors script/deploy-oracle.mjs.
//
// Inputs (.env or environment):
//   MARKET_ORACLE      oracle address (default: address in oracle/deployment.json)
//   MARKET_PLATFORM    e.g. "polymarket"   ─┐ marketId = keccak256(abi.encode(...))
//   MARKET_REF         e.g. "0xabc123"     ─┘ exactly as PredgeOracle derives it
//   MARKET_ID          explicit 0x-prefixed bytes32 (overrides platform/ref)
//   MARKET_OPEN_MINUTES  minutes of betting from now (default 60)
//   MARKET_DEADLINE      explicit unix seconds (overrides MARKET_OPEN_MINUTES)
//
// The constructor itself refuses to deploy unless `oracle.isCommitted(marketId)`
// is true and the market is not already resolved. This script pre-flights both
// so you get a sentence instead of a reverted deploy — but the CONTRACT is the
// enforcement; the script is only being polite.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import solc from "solc";
import { AbiCoder, Contract, JsonRpcProvider, Network, Wallet, ContractFactory, keccak256 } from "ethers";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(label, fn, tries = 8) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e && (e.error?.message || e.shortMessage || e.message)) || "";
      if (!/request limit|rate|-32011|timeout|coalesce|failed to detect network/i.test(msg)) throw e;
      lastErr = e;
      const wait = 1500 * (i + 1);
      console.log(`  (${label}) rate-limited, retry ${i + 1}/${tries} in ${wait}ms…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

const ENV = new URL("../.env", import.meta.url).pathname;
const SOL = new URL("../contracts/ExampleMarket.sol", import.meta.url).pathname;
const ORACLE_DEPLOYMENT = new URL("../oracle/deployment.json", import.meta.url).pathname;
const OUT_DIR = new URL("../market/", import.meta.url).pathname;
const DEPLOYMENT = OUT_DIR + "deployment.json";
const EXPLORER = "https://testnet.arcscan.app";

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = { ...parseEnv(ENV), ...process.env };
const RPC = env.ARC_RPC || "https://rpc.testnet.arc.io";
const PK = env.PRIVATE_KEY;
if (!PK) {
  console.error("No PRIVATE_KEY in .env — run `npm run genwallet` first.");
  process.exit(1);
}

// ---- resolve oracle + marketId ----
let oracleAddr = env.MARKET_ORACLE;
if (!oracleAddr) {
  if (!existsSync(ORACLE_DEPLOYMENT)) {
    console.error("No MARKET_ORACLE and no oracle/deployment.json — run `npm run deploy-oracle` first.");
    process.exit(1);
  }
  oracleAddr = JSON.parse(readFileSync(ORACLE_DEPLOYMENT, "utf8")).address;
}

const platform = env.MARKET_PLATFORM || "";
const marketRef = env.MARKET_REF || "";
let marketId = env.MARKET_ID;
if (marketId) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
    console.error("MARKET_ID must be a 0x-prefixed 32-byte hex string.");
    process.exit(1);
  }
} else {
  if (!platform || !marketRef) {
    console.error("Set MARKET_PLATFORM + MARKET_REF (or MARKET_ID) — the market the oracle pre-committed.");
    process.exit(1);
  }
  // Identical to PredgeOracle.marketIdFor: abi.encode is length-prefixed and
  // therefore injective, so two different markets can never share one key.
  marketId = keccak256(AbiCoder.defaultAbiCoder().encode(["string", "string"], [platform, marketRef]));
}

const nowSec = Math.floor(Date.now() / 1000);
const deadline = env.MARKET_DEADLINE
  ? Number(env.MARKET_DEADLINE)
  : nowSec + 60 * Number(env.MARKET_OPEN_MINUTES || 60);
if (!Number.isFinite(deadline) || deadline <= nowSec) {
  console.error("Betting deadline must be in the future (MARKET_DEADLINE / MARKET_OPEN_MINUTES).");
  process.exit(1);
}

// ---- compile ----
const source = readFileSync(SOL, "utf8");
const input = {
  language: "Solidity",
  sources: { "ExampleMarket.sol": { content: source } },
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
for (const w of (out.errors || []).filter((e) => e.severity !== "error")) {
  console.log("solc " + w.severity + ": " + (w.formattedMessage || w.message).trim());
}
const c = out.contracts["ExampleMarket.sol"]["ExampleMarket"];
const abi = c.abi;
const bytecode = "0x" + c.evm.bytecode.object;
console.log("Compiled ExampleMarket (solc " + solc.version() + "), " + (bytecode.length - 2) / 2 + " bytes.");

// ---- pre-flight the oracle binding ----
const ARC_CHAINID = BigInt(env.ARC_CHAINID || "5042002");
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(ARC_CHAINID) });
const wallet = new Wallet(PK, provider);

const oracle = new Contract(
  oracleAddr,
  [
    "function isCommitted(bytes32) view returns (bool)",
    "function isResolved(bytes32) view returns (bool)",
  ],
  provider,
);
const committed = await withRetry("isCommitted", () => oracle.isCommitted(marketId));
if (!committed) {
  console.error(
    "\nOracle has NO pre-commitment for this marketId — refusing to open a market.\n" +
      "  marketId: " + marketId + "\n" +
      "  Run: node oracle.mjs commit " + (platform || "<platform>") + " " + (marketRef || "<ref>") + "\n" +
      "(The constructor enforces this too; this is just a friendlier failure.)",
  );
  process.exit(1);
}
const alreadyResolved = await withRetry("isResolved", () => oracle.isResolved(marketId));
if (alreadyResolved) {
  console.error("\nThis market is ALREADY resolved — opening betting on a known outcome is refused.");
  process.exit(1);
}

const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log("Deployer:  ", wallet.address);
console.log("Oracle:    ", oracleAddr);
console.log("marketId:  ", marketId, platform ? `(${platform}:${marketRef})` : "");
console.log("Deadline:  ", deadline, "→", new Date(deadline * 1000).toISOString());
console.log("Chain:", ARC_CHAINID.toString(), "| native balance:", bal.toString());
if (bal === 0n) {
  console.error("Balance is 0 — fund the deployer at https://faucet.circle.com (Arc Testnet, USDC), then re-run.");
  process.exit(1);
}

// ---- deploy ----
const factory = new ContractFactory(abi, bytecode, wallet);
const contract = await withRetry("deploy", () => factory.deploy(oracleAddr, marketId, deadline));
const deployTx = contract.deploymentTransaction();
console.log("Deploy tx:", deployTx.hash);
await withRetry("waitForDeployment", () => contract.waitForDeployment());
const addr = await contract.getAddress();
console.log("\nExampleMarket deployed at:", addr);
console.log("   " + EXPLORER + "/address/" + addr);
console.log("   deploy tx: " + EXPLORER + "/tx/" + deployTx.hash);
console.log("   oracle:    " + EXPLORER + "/address/" + oracleAddr);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  DEPLOYMENT,
  JSON.stringify(
    {
      address: addr,
      oracle: oracleAddr,
      marketId,
      platform: platform || null,
      marketRef: marketRef || null,
      bettingDeadline: deadline,
      resolutionDeadline: deadline + 90 * 24 * 60 * 60,
      deployer: wallet.address,
      chainId: Number(ARC_CHAINID),
      deployTx: deployTx.hash,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote market/deployment.json.");
console.log("\nNext:");
console.log("  stake:  betYes() / betNo() with native USDC before the deadline");
console.log("  then:   node oracle.mjs resolve " + (platform || "<platform>") + " " + (marketRef || "<ref>") + " yes");
console.log("  then:   settle() once (permissionless), then each staker calls claim()");
