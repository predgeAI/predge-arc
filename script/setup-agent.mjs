// Ensure the demo agent has its own Arc-testnet wallet, and (if a funded
// deployer key is present) top it up with a little native USDC for the demo.
//
//   npm run setup-agent            # generate if missing + top up to 0.05 USDC
//   npm run setup-agent -- 0.1     # custom top-up amount (USDC)
//
// Testnet only. Keys live in .env (gitignored) — never in code, never committed.
import { Wallet, parseEther } from "ethers";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { DEFAULT_RPC, fmtUsdc, makeProvider, txLink, withRetry } from "../lib/arc.mjs";

const ENV_PATH = new URL("../.env", import.meta.url).pathname;
const env = loadEnv(ENV_PATH);
const topUpUsdc = process.argv[2] || "0.05";

let agentPk = env.AGENT_PRIVATE_KEY;
let agent;
if (agentPk) {
  agent = new Wallet(agentPk);
  console.log("Agent wallet already in .env.");
} else {
  agent = Wallet.createRandom();
  const prefix = existsSync(ENV_PATH) && !readFileSync(ENV_PATH, "utf8").endsWith("\n") ? "\n" : "";
  appendFileSync(ENV_PATH, `${prefix}AGENT_PRIVATE_KEY=${agent.privateKey}\n`);
  console.log("Generated a fresh agent wallet; key appended to .env (gitignored).");
}
console.log("AGENT ADDRESS:", agent.address);

const provider = makeProvider(env.ARC_RPC || DEFAULT_RPC);
const bal = await withRetry("getBalance", () => provider.getBalance(agent.address));
console.log("Agent balance:", fmtUsdc(bal), "USDC (native)");

const target = parseEther(topUpUsdc);
if (bal >= target) {
  console.log("Agent already funded — nothing to do.");
  process.exit(0);
}

if (!env.PRIVATE_KEY) {
  console.log(
    `\nNo deployer PRIVATE_KEY in .env to top up from.\n` +
      `Fund the agent manually: https://faucet.circle.com → Arc Testnet → USDC → ${agent.address}`,
  );
  process.exit(0);
}

const deployer = new Wallet(env.PRIVATE_KEY, provider);
const deployerBal = await withRetry("getBalance", () => provider.getBalance(deployer.address));
console.log(`Topping up ${topUpUsdc} USDC from deployer ${deployer.address} (${fmtUsdc(deployerBal)} USDC)…`);
if (deployerBal < target + 10n ** 15n) {
  console.error("Deployer can't cover the top-up — fund it at https://faucet.circle.com first.");
  process.exit(1);
}
const tx = await withRetry("fund", () => deployer.sendTransaction({ to: agent.address, value: target - bal }));
console.log("  sent", tx.hash);
await withRetry("fund.wait", () => tx.wait());
const after = await withRetry("getBalance", () => provider.getBalance(agent.address));
console.log(`Funded. Agent balance: ${fmtUsdc(after)} USDC`);
console.log("  " + txLink(tx.hash));
