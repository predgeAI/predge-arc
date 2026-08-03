// Compile contracts/PredgeSignalVault.sol (solc 0.8.26, optimizer 200 — same as
// the existing PredgeSettlement deploy) and deploy it to Circle Arc testnet with
// the keeper set at construction. Writes vault/deployment.json so the keeper can
// find the address. Mirrors script/deploy.js.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
const SOL = new URL("../contracts/PredgeSignalVault.sol", import.meta.url).pathname;
const DEPLOYMENT = new URL("../vault/deployment.json", import.meta.url).pathname;
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
  sources: { "PredgeSignalVault.sol": { content: source } },
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
const c = out.contracts["PredgeSignalVault.sol"]["PredgeSignalVault"];
const abi = c.abi;
const bytecode = "0x" + c.evm.bytecode.object;
console.log("Compiled PredgeSignalVault (solc " + solc.version() + ").");

// ---- deploy ----
const ARC_CHAINID = BigInt(env.ARC_CHAINID || "5042002");
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(ARC_CHAINID) });
const wallet = new Wallet(PK, provider);
// Keeper = the off-chain agent allowed to call rebalance(). Defaults to the
// operator (who has gas); override with VAULT_KEEPER in .env.
const keeper = env.VAULT_KEEPER || wallet.address;
const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log("Deployer:", wallet.address);
console.log("Keeper:  ", keeper);
console.log("Chain:", ARC_CHAINID.toString(), "| native balance:", bal.toString());
if (bal === 0n) {
  console.error("Balance is 0 — fund the deployer at https://faucet.circle.com (Arc Testnet, USDC), then re-run.");
  process.exit(1);
}

const factory = new ContractFactory(abi, bytecode, wallet);
const contract = await withRetry("deploy", () => factory.deploy(keeper));
const deployTx = contract.deploymentTransaction();
console.log("Deploy tx:", deployTx.hash);
await withRetry("waitForDeployment", () => contract.waitForDeployment());
const addr = await contract.getAddress();
console.log("\nPredgeSignalVault deployed at:", addr);
console.log("   " + EXPLORER + "/address/" + addr);
console.log("   deploy tx: " + EXPLORER + "/tx/" + deployTx.hash);

writeFileSync(
  DEPLOYMENT,
  JSON.stringify(
    { address: addr, keeper, deployer: wallet.address, chainId: Number(ARC_CHAINID), deployTx: deployTx.hash, deployedAt: new Date().toISOString() },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote vault/deployment.json (gitignored). Keeper reads VAULT_ADDRESS from here.");
console.log("\nNext:");
console.log("  node vault-keeper.mjs deposit 0.01     # fund the vault");
console.log("  node vault-keeper.mjs run --sample riskon   # signed signal -> verify -> rebalance");
