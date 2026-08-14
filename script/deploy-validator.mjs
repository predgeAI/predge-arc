// Compile contracts/PredgeAgentValidator.sol (solc 0.8.26, optimizer 200 — same
// settings as PredgeOracle) and deploy it to Circle Arc testnet, with the validator
// set at construction. Writes oracle/validator-deployment.json. Mirrors deploy-oracle.mjs.
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
const SOL = new URL("../contracts/PredgeAgentValidator.sol", import.meta.url).pathname;
const OUT_DIR = new URL("../oracle/", import.meta.url).pathname;
const DEPLOYMENT = OUT_DIR + "validator-deployment.json";
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

// ---- compile (strip the SPDX-only pragma import graph: single self-contained file) ----
const source = readFileSync(SOL, "utf8");
const input = {
  language: "Solidity",
  sources: { "PredgeAgentValidator.sol": { content: source } },
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
const c = out.contracts["PredgeAgentValidator.sol"]["PredgeAgentValidator"];
const bytecode = "0x" + c.evm.bytecode.object;
console.log("Compiled PredgeAgentValidator (solc " + solc.version() + ").");

const ARC_CHAINID = BigInt(env.ARC_CHAINID || "5042002");
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(ARC_CHAINID) });
const wallet = new Wallet(PK, provider);
const validatorAddr = env.ORACLE_PUBLISHER || wallet.address;
const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log("Deployer: ", wallet.address);
console.log("Validator:", validatorAddr);
console.log("Chain:", ARC_CHAINID.toString(), "| native balance:", bal.toString());
if (bal === 0n) {
  console.error("Balance is 0 — fund at https://faucet.circle.com (Arc Testnet), then re-run.");
  process.exit(1);
}

const factory = new ContractFactory(c.abi, bytecode, wallet);
const contract = await withRetry("deploy", () => factory.deploy(validatorAddr));
const deployTx = contract.deploymentTransaction();
console.log("Deploy tx:", deployTx.hash);
await withRetry("waitForDeployment", () => contract.waitForDeployment());
const addr = await contract.getAddress();
console.log("\nPredgeAgentValidator deployed at:", addr);
console.log("   " + EXPLORER + "/address/" + addr);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  DEPLOYMENT,
  JSON.stringify(
    {
      address: addr,
      validator: validatorAddr,
      deployer: wallet.address,
      chainId: Number(ARC_CHAINID),
      deployTx: deployTx.hash,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log("\nWrote oracle/validator-deployment.json");
