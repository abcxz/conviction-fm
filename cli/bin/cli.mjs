#!/usr/bin/env node

/**
 * conviction — Autonomous strategy competition CLI
 *
 * Usage:
 *   npx conviction                    Interactive: prompt a strategy
 *   npx conviction create "rules"     Create agent with strategy in one shot
 *   npx conviction enter <apiKey> BTC Enter a pool directly
 *   npx conviction pools              Show open pools
 *   npx conviction leaderboard        Show strategy rankings
 */

import { createAgent, placeBet, getPools, getLeaderboard } from '../lib/api.mjs';
import { createInterface } from 'readline';

const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function print(msg = '') { process.stdout.write(msg + '\n'); }

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ─── Commands ───

async function cmdCreate(rulesArg) {
  print();
  print(`${RED}${BOLD}  CONVICTION.FM${RESET}`);
  print(`${DIM}  Autonomous strategy competition${RESET}`);
  print();

  let name, rules;
  if (rulesArg) {
    name = 'CLI Agent';
    rules = rulesArg;
    print(`${DIM}  Strategy: ${rules}${RESET}`);
  } else {
    name = await ask(`${CYAN}  Agent name ${DIM}(optional)${RESET}${CYAN}: ${RESET}`);
    print();
    print(`${DIM}  Prompt your strategy in plain English. Examples:${RESET}`);
    print(`${DIM}  - "Enter with $5 on the likely winner when probability > 70%"${RESET}`);
    print(`${DIM}  - "Go contrarian: pick the underdog when pool is 60/40 or worse"${RESET}`);
    print(`${DIM}  - "Enter every pool with $2, always pick higher probability"${RESET}`);
    print();
    rules = await ask(`${CYAN}  Strategy: ${RESET}`);
    if (!rules) {
      print(`${RED}  No strategy provided. Exiting.${RESET}`);
      process.exit(1);
    }
  }

  print();
  print(`${DIM}  Creating agent...${RESET}`);

  const result = await createAgent({ name: name || undefined, rules });

  if (!result.success) {
    print(`${RED}  Error: ${result.error}${RESET}`);
    process.exit(1);
  }

  print();
  print(`${GREEN}${BOLD}  Agent created!${RESET}`);
  print();
  print(`  ${BOLD}Name:${RESET}    ${result.agent.name}`);
  print(`  ${BOLD}Wallet:${RESET}  ${result.agent.walletAddress}`);
  print(`  ${BOLD}API Key:${RESET} ${YELLOW}${result.agent.apiKey}${RESET}`);
  print(`  ${BOLD}Funded:${RESET}  ${result.airdrop?.funded ? `${GREEN}500 bsUSD${RESET}` : `${RED}Not funded${RESET}`}`);
  print(`  ${BOLD}Rules:${RESET}   ${result.compiled?.success ? `${GREEN}Compiled (${result.compiled.rulesCount} rules)${RESET}` : `${YELLOW}Pending${RESET}`}`);
  print();
  print(`${DIM}  Your agent will start competing automatically every minute.${RESET}`);
  print(`${DIM}  Track it at: ${RESET}${CYAN}https://conviction.fm/strategy${RESET}`);
  print();
  print(`${YELLOW}${BOLD}  Save your API key — it won't be shown again.${RESET}`);
  print();
}

async function cmdEnter(apiKey, side, amount) {
  if (!apiKey || !side) {
    print(`${RED}  Usage: conviction build <apiKey> <SIDE> [amount]${RESET}`);
    print(`${DIM}  Example: conviction build cfm_abc123 BTC 5${RESET}`);
    process.exit(1);
  }

  // Figure out the pool — get open pools and find one with this token
  print(`${DIM}  Fetching open pools...${RESET}`);
  const poolData = await getPools();
  const pools = poolData.pools || [];

  if (pools.length === 0) {
    print(`${RED}  No open pools right now.${RESET}`);
    process.exit(1);
  }

  // Find a pool containing the selected token
  const sideUpper = side.toUpperCase();
  const pool = pools.find(p =>
    p.tokenA?.id?.toUpperCase() === sideUpper ||
    p.tokenB?.id?.toUpperCase() === sideUpper
  );

  if (!pool) {
    print(`${RED}  No open pool found for ${sideUpper}${RESET}`);
    print(`${DIM}  Available pools: ${pools.map(p => p.tokenPairKey).join(', ')}${RESET}`);
    process.exit(1);
  }

  const tokenA = pool.tokenA?.id || pool.tokenPairKey.split('-')[0];
  const tokenB = pool.tokenB?.id || pool.tokenPairKey.split('-')[1];

  print(`${DIM}  Entering $${amount || 1} on ${sideUpper} in ${pool.tokenPairKey}...${RESET}`);

  const result = await placeBet({
    apiKey,
    tokenA,
    tokenB,
    side: sideUpper,
    amount: Number(amount) || 1,
  });

  if (result.success) {
    print(`${GREEN}${BOLD}  Entry placed!${RESET}`);
    print(`  ${BOLD}Pool:${RESET}       ${pool.tokenPairKey}`);
    print(`  ${BOLD}Side:${RESET}       ${sideUpper}`);
    print(`  ${BOLD}Amount:${RESET}     $${amount || 1}`);
    print(`  ${BOLD}Conviction:${RESET} ${result.convictionMultiplier?.toFixed(3) || '1.000'}`);
    print(`  ${BOLD}Win Prob:${RESET}   ${result.winProbability?.toFixed(1) || '?'}%`);
    print(`  ${BOLD}Tx:${RESET}         ${DIM}${result.explorerUrl}${RESET}`);
  } else {
    print(`${RED}  Error: ${result.error}${RESET}`);
  }
  print();
}

async function cmdPools() {
  const data = await getPools();
  const pools = data.pools || [];

  print();
  print(`${BOLD}  OPEN POOLS${RESET}  ${DIM}(${pools.length} active)${RESET}`);
  print();

  for (const p of pools) {
    const aShare = p.tokenA?.poolSharePercent?.toFixed(1) || '50.0';
    const bShare = p.tokenB?.poolSharePercent?.toFixed(1) || '50.0';
    const aAmt = p.tokenA?.poolAmount?.toFixed(0) || '0';
    const bAmt = p.tokenB?.poolAmount?.toFixed(0) || '0';
    const hrs = p.hoursRemaining?.toFixed(1) || '?';
    const total = p.totalPoolUsdc?.toFixed(0) || '?';
    const aName = p.tokenA?.id || p.tokenPairKey.split('-')[0];
    const bName = p.tokenB?.id || p.tokenPairKey.split('-')[1];

    print(`  ${BOLD}${p.tokenPairKey}${RESET}  ${DIM}(${hrs}h left, $${total} pool)${RESET}`);
    print(`    ${aName}: ${CYAN}${aShare}%${RESET} pool ${DIM}($${aAmt})${RESET}`);
    print(`    ${bName}: ${CYAN}${bShare}%${RESET} pool ${DIM}($${bAmt})${RESET}`);
    print();
  }
}

async function cmdLeaderboard() {
  const data = await getLeaderboard('agents');
  const rankings = data.rankings || [];

  print();
  print(`${BOLD}  STRATEGY LEADERBOARD${RESET}  ${DIM}(top ${rankings.length})${RESET}`);
  print();

  for (const r of rankings.slice(0, 15)) {
    const profit = r.netProfit >= 0 ? `${GREEN}+$${r.netProfit.toFixed(2)}${RESET}` : `${RED}-$${Math.abs(r.netProfit).toFixed(2)}${RESET}`;
    print(`  ${DIM}#${r.rank}${RESET}  ${BOLD}${r.displayName}${RESET}  ${profit}  ${DIM}${r.totalBets} bets, ${r.winRate}% win${RESET}`);
  }
  print();
}

// ─── Main ───

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'create') {
  cmdCreate(args[1]).catch(e => { print(`${RED}Error: ${e.message}${RESET}`); process.exit(1); });
} else if (command === 'build' || command === 'enter' || command === 'bet') {
  cmdEnter(args[1], args[2], args[3]).catch(e => { print(`${RED}Error: ${e.message}${RESET}`); process.exit(1); });
} else if (command === 'pools') {
  cmdPools().catch(e => { print(`${RED}Error: ${e.message}${RESET}`); process.exit(1); });
} else if (command === 'leaderboard' || command === 'lb') {
  cmdLeaderboard().catch(e => { print(`${RED}Error: ${e.message}${RESET}`); process.exit(1); });
} else if (command === 'help' || command === '--help' || command === '-h') {
  print();
  print(`${RED}${BOLD}  CONVICTION${RESET}  ${DIM}— Autonomous strategy competition${RESET}`);
  print();
  print(`  ${BOLD}Commands:${RESET}`);
  print(`    ${CYAN}conviction${RESET}                         Prompt a strategy interactively`);
  print(`    ${CYAN}conviction create "strategy"${RESET}       Create agent with strategy`);
  print(`    ${CYAN}conviction build <key> <SIDE> [amt]${RESET}   Enter a position`);
  print(`    ${CYAN}conviction pools${RESET}                   Show open pools`);
  print(`    ${CYAN}conviction leaderboard${RESET}             Strategy rankings`);
  print();
  print(`  ${DIM}https://conviction.fm${RESET}`);
  print();
} else {
  // Treat the entire args as a strategy string
  cmdCreate(args.join(' ')).catch(e => { print(`${RED}Error: ${e.message}${RESET}`); process.exit(1); });
}
