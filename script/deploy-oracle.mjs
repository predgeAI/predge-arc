// Compile contracts/PredgeOracle.sol (solc 0.8.26, optimizer 200 — same settings
// as PredgeSettlement / PredgeSignalVault) and deploy it to Circle Arc testnet
// with the publisher set at construction. Writes oracle/deployment.json so the
// publisher CLI and any consuming contract can find the address.
// Mirrors script/deploy-vault.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import solc from "solc";
import { JsonRpcProvider, Network, Wallet, ContractFactory } from "ethers";

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
const SOL = new URL("../contracts/PredgeOracle.sol", import.meta.url).pathname;
const OUT_DIR = new URL("../oracle/", import.meta.url).pathname;
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
  sources: { "PredgeOracle.sol": { content: source } },
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
const c = out.contracts["PredgeOracle.sol"]["PredgeOracle"];
const abi = c.abi;
const bytecode = "0x" + c.evm.bytecode.object;
console.log("Compiled PredgeOracle (solc " + solc.version() + ").");

// ---- deploy ----
const ARC_CHAINID = BigInt(env.ARC_CHAINID || "5042002");
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(ARC_CHAINID) });
const wallet = new Wallet(PK, provider);
// Publisher = the off-chain Predge service allowed to commit/resolve. Defaults
// to the operator (who has gas); override with ORACLE_PUBLISHER in .env.
const publisher = env.ORACLE_PUBLISHER || wallet.address;
const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log("Deployer: ", wallet.address);
console.log("Publisher:", publisher);
console.log("Chain:", ARC_CHAINID.toString(), "| native balance:", bal.toString());
if (bal === 0n) {
  console.error("Balance is 0 — fund the deployer at https://faucet.circle.com (Arc Testnet, USDC), then re-run.");
  process.exit(1);
}

const factory = new ContractFactory(abi, bytecode, wallet);
const contract = await withRetry("deploy", () => factory.deploy(publisher));
const deployTx = contract.deploymentTransaction();
console.log("Deploy tx:", deployTx.hash);
await withRetry("waitForDeployment", () => contract.waitForDeployment());
const addr = await contract.getAddress();
console.log("\nPredgeOracle deployed at:", addr);
console.log("   " + EXPLORER + "/address/" + addr);
console.log("   deploy tx: " + EXPLORER + "/tx/" + deployTx.hash);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  DEPLOYMENT,
  JSON.stringify(
    {
      address: addr,
      publisher,
      deployer: wallet.address,
      chainId: Number(ARC_CHAINID),
      deployTx: deployTx.hash,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote oracle/deployment.json (gitignored).");
console.log("\nNext:");
console.log("  node oracle.mjs demo     # commit -> resolve -> read, and prove a rewrite reverts");
