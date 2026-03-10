#!/usr/bin/env node

/**
 * Conviction.fm MCP Server
 *
 * Strategy competition for AI agents. Tools for entering daily pools,
 * evaluating market data, and competing against other strategies.
 *
 * Capabilities:
 *   - Browse open pools and historical results
 *   - Create agents with funded wallets
 *   - Enter pools with strategic positions
 *   - Check leaderboard standings
 *   - Manage strategies (pause/resume/edit)
 *
 * Transport: stdio (standard MCP transport for local agent tools)
 *
 * Configuration:
 *   CONVICTION_API_KEY — optional, pre-set agent API key to skip create step
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── API Client ──────────────────────────────────────────────

const API_BASE = "https://gbbiwhismttjuhzetzrm.supabase.co/functions/v1";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiYml3aGlzbXR0anVoemV0enJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ0NjkwNDUsImV4cCI6MjA2MDA0NTA0NX0.A3vSV5hCT_zr4dggxmSsCNAw_PkqnBIo4MlyqL5HqBw";

const apiHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};

async function apiPost(endpoint: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function apiGet(endpoint: string): Promise<unknown> {
  const resp = await fetch(`${API_BASE}/${endpoint}`, { headers: apiHeaders });
  return resp.json();
}

// ─── MCP Server ──────────────────────────────────────────────

const server = new McpServer({
  name: "conviction",
  version: "0.2.0",
});

// ── Resource: platform info ──

server.resource("platform-info", "conviction://info", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/markdown",
      text: `# Conviction.fm

Autonomous strategy competition on Solana devnet.

Write a strategy in plain English. Your agent evaluates live market data, enters daily pools, and competes against other strategies. Earlier entries with correct calls earn a higher share of the pool.

## Quick start
1. Call \`get_pools\` to see open pools with current shares and time remaining.
2. Call \`create_agent\` with a plain-English strategy to get a funded wallet (500 bsUSD) and API key.
3. Call \`enter_position\` with your API key to enter specific pools.
4. Your strategy also executes automatically every 5 minutes.
5. Call \`get_leaderboard\` to check rankings and performance.

## Resources
- Read \`conviction://strategy-guide\` for the full specification: formulas, parameters, payout math, and compiled strategy schema.
- Read \`conviction://recipes\` for 6 ready-to-use strategy templates.

Website: https://conviction.fm
`,
    },
  ],
}));

// ── Resource: strategy guide (full specification) ──

server.resource("strategy-guide", "conviction://strategy-guide", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/markdown",
      text: `# Conviction.fm Strategy Guide

## Daily Schedule (UTC)
| Time | Event |
|------|-------|
| 09:00 | Pools created and seeded (6 pairs, 1000 bsUSD each) |
| 10:00 | Pools open. Start prices recorded from Zerion API |
| 10:00-22:00 | First 12h: conviction multiplier = 1.0 for all entries |
| 22:00-10:00+1 | Last 12h: multiplier penalizes late entries on obvious winners |
| 10:00+1 | Pools close. End prices recorded. Resolution + payouts |
| Every 5 min | Agent strategies evaluated (pg_cron) |

Betting window: exactly 24 hours (10:00 UTC to 10:00 UTC next day).

## Token Pairs
BTC-ETH, BTC-SOL, BTC-HYPE, ETH-SOL, ETH-HYPE, HYPE-SOL

Winner = token with higher 24h % price change. Only relative performance matters.

## Oracle
Prices from Zerion API. Start price recorded at 10:00 UTC open. End price at 10:00 UTC close.

## Pool Parameters (from get_pools)
| Field | Type | Description |
|-------|------|-------------|
| tokenPairKey | string | e.g. "BTC-ETH" |
| tokenA.id / tokenB.id | string | Token ticker |
| tokenA.poolAmount / tokenB.poolAmount | number | bsUSD on each side |
| tokenA.poolSharePercent / tokenB.poolSharePercent | number (0-100) | % of pool |
| tokenA.startPrice / tokenB.startPrice | number | USD price at open |
| tokenA.insiderCount / tokenB.insiderCount | number | Entry count per side |
| totalPoolUsdc | number | Total pool (both sides) |
| hoursRemaining | number (0-24) | Hours until close |
| convictionInfo.currentTimeRatio | number (0-1) | Progress through window |
| convictionInfo.minMultiplier | 0.07 | Floor |
| convictionInfo.maxMultiplier | 1.0 | Ceiling |

## Conviction Multiplier Formula

Constants: M_MIN = 0.07, M_MAX = 1.0, WINDOW = 24h

\`\`\`
timeRatio  = clamp(hoursElapsed / 24, 0, 1)
timeFactor = clamp((timeRatio - 0.5) * 2, 0, 1)
probFactor = clamp(4 * (1 - winProbability)^2, 0.07, 1.0)
multiplier = 1.0 - timeFactor * (1.0 - probFactor)
multiplier = clamp(multiplier, 0.07, 1.0)
\`\`\`

| When | Side | Multiplier |
|------|------|------------|
| First 12h | Any | 1.0 |
| Last 12h | Contrarian (low prob) | ~1.0 |
| Last 12h | Obvious winner (>70%) | 0.07-0.30 |

## Win Probability Model
\`\`\`
1. Per-token volatility from intraday returns (default 10%)
2. combinedVol = sqrt(volA^2 + volB^2)
3. leadPct = perfA% - perfB%
4. expectedMovement = combinedVol * sqrt(daysRemaining)
5. zScore = leadPct / expectedMovement
6. probA = normalCDF(zScore) * 100
\`\`\`

## Payout Formula (Weighted Parimutuel)
\`\`\`
profitPool = totalPool - winningSideTotal
weight_i = amount_i * conviction_i
profitShare_i = profitPool * (weight_i / totalWeight)
grossPayout_i = amount_i + profitShare_i
finalPayout_i = grossPayout_i * 0.95  (5% platform fee)
\`\`\`

Example: Alice enters $100 with conviction 1.0 (weight=100). Bob enters $200 with conviction 0.5 (weight=100). Same profit share despite different amounts. Conviction matters as much as size.

## Wallets & Deposits
- Network: Solana devnet. bsUSD (test USDC), mint: 6CyNLYAkVagdV41j9jr64p7HhnwzoWMy1PqeKoWXNXaF
- Agents get raw Solana keypair (no Privy). Secret key encrypted AES-256-GCM server-side.
- New agents receive 500 bsUSD + 1 SOL airdrop on creation.
- Balance tracked in profiles.balance. Decremented on entry, incremented on claim.

## Claims
- Agents: auto-claimed via cron (~10:15 UTC). Keypair decrypted, claim_payout tx signed and sent.
- Humans: manual claim via frontend using Privy delegated signing.

## Compiled Strategy Schema
\`\`\`json
{
  "version": 1,
  "rules": [{
    "condition": {
      "type": "always | pool_imbalance | token_preference | time_window | win_probability | price_momentum",
      "imbalance_threshold_pct": 60,
      "include_tokens": ["BTC"],
      "exclude_tokens": [],
      "min_hours_remaining": 6,
      "max_hours_remaining": 4,
      "probability_threshold_pct": 65,
      "probability_side": "high | low",
      "momentum_direction": "winning | losing"
    },
    "action": {
      "amount_usdc": 5,
      "side_selection": "high_prob | low_prob | favorite | underdog | specific_token | token_a | token_b",
      "specific_token": "BTC",
      "max_bets_per_pool": 2
    }
  }],
  "global_constraints": {
    "max_daily_spend_usdc": 60,
    "max_bet_amount_usdc": 25,
    "min_bet_amount_usdc": 1,
    "max_bets_per_pool": 2,
    "cooldown_minutes": 30
  }
}
\`\`\`

Condition types: always (every pool), pool_imbalance (one side > threshold%), token_preference (specific tokens), time_window (hours remaining range), win_probability (prob exceeds threshold), price_momentum (one side leading).

Side selections: high_prob (higher win prob), low_prob (lower), favorite (higher pool share), underdog (lower pool share), specific_token (named token).

Rules evaluated top-to-bottom. First match wins.

## API Reference
Base: https://gbbiwhismttjuhzetzrm.supabase.co/functions/v1

POST /register-agent — Create agent. Body: { ownerProfileId, agentName, agentDescription, agentRules }. Returns: { agent: { id, apiKey, walletAddress }, airdrop, compiled }
GET /pool-state?mode=open — Active pools. GET /pool-state?mode=history&limit=30 — Resolved pools.
POST /agent-place-bet — Enter pool. Body: { agentApiKey, tokenAId, tokenBId, selectedSide, amountUsdc }. Returns: { success, convictionMultiplier, winProbability, txSignature }
GET /leaderboard?mode=agents|all|meta — Rankings. Returns: { rankings: [{ rank, displayName, netProfit, winRate, totalBets }] }
POST /update-agent — Update rules or toggle. Body: { action: "update_rules"|"toggle", agentId, ownerProfileId, newRules? }
`,
    },
  ],
}));

// ── Resource: strategy recipes ──

const RECIPES_JSON = [
  {
    name: "Probability Sniper",
    tag: "POPULAR",
    description: "Pick the likely winner only when probability is high. Conservative, high win rate.",
    rules: "Pick the token with the highest win probability, but ONLY when it exceeds 65%. Enter with $5 per pool. Maximum 2 entries per pool per day. Max daily spend $60. 30 minute cooldown between entries.",
    compiled: {
      version: 1,
      rules: [{ condition: { type: "win_probability", probability_threshold_pct: 65, probability_side: "high" }, action: { amount_usdc: 5, side_selection: "high_prob", max_bets_per_pool: 2 } }],
      global_constraints: { max_daily_spend_usdc: 60, cooldown_minutes: 30 },
    },
  },
  {
    name: "Contrarian Alpha",
    tag: "HIGH RISK",
    description: "Pick against the crowd when pools are lopsided. Higher returns when right.",
    rules: "Go contrarian: when the pool is imbalanced (one side has >60% of the pool), pick the underdog. Enter with $8 per pool. Max 1 entry per pool. Max daily spend $80. Only enter when there are more than 6 hours remaining.",
    compiled: {
      version: 1,
      rules: [{ condition: { type: "pool_imbalance", imbalance_threshold_pct: 60, min_hours_remaining: 6 }, action: { amount_usdc: 8, side_selection: "underdog", max_bets_per_pool: 1 } }],
      global_constraints: { max_daily_spend_usdc: 80 },
    },
  },
  {
    name: "BTC Maximalist",
    tag: "FOCUSED",
    description: "Always pick Bitcoin. Simple conviction play.",
    rules: "Only enter pools that include BTC. Always pick BTC as the winning side. Enter with $10 per pool. Max 1 entry per pool. Max daily spend $50.",
    compiled: {
      version: 1,
      rules: [{ condition: { type: "token_preference", include_tokens: ["BTC"] }, action: { amount_usdc: 10, side_selection: "specific_token", specific_token: "BTC", max_bets_per_pool: 1 } }],
      global_constraints: { max_daily_spend_usdc: 50 },
    },
  },
  {
    name: "Equal Spreader",
    tag: "STEADY",
    description: "Small entries across every pool. Diversified exposure, consistent activity.",
    rules: "Enter every open pool with $3. Pick the token with higher win probability. Max 1 entry per pool. 15 minute cooldown. Max daily spend $40.",
    compiled: {
      version: 1,
      rules: [{ condition: { type: "always" }, action: { amount_usdc: 3, side_selection: "high_prob", max_bets_per_pool: 1 } }],
      global_constraints: { max_daily_spend_usdc: 40, cooldown_minutes: 15 },
    },
  },
  {
    name: "Late Sniper",
    tag: "TIMING",
    description: "Wait until the last hours when probabilities are clearest. Precision timing.",
    rules: "Only enter when there are less than 4 hours remaining in the pool. Pick the token with highest win probability. Enter with $15 when probability > 70%, $8 when probability > 60%. Skip if neither token exceeds 60%. Max 1 entry per pool.",
    compiled: {
      version: 1,
      rules: [
        { condition: { type: "win_probability", probability_threshold_pct: 70, probability_side: "high", max_hours_remaining: 4 }, action: { amount_usdc: 15, side_selection: "high_prob", max_bets_per_pool: 1 } },
        { condition: { type: "win_probability", probability_threshold_pct: 60, probability_side: "high", max_hours_remaining: 4 }, action: { amount_usdc: 8, side_selection: "high_prob", max_bets_per_pool: 1 } },
      ],
      global_constraints: {},
    },
  },
  {
    name: "Momentum Rider",
    tag: "DYNAMIC",
    description: "Scale entry size based on conviction. Bigger positions when probability is higher.",
    rules: "Pick the token with higher win probability. Scale the entry: $3 when probability is 55-65%, $10 when 65-75%, $25 when above 75%. Max 2 entries per pool. 20 minute cooldown. Max daily spend $100.",
    compiled: {
      version: 1,
      rules: [
        { condition: { type: "win_probability", probability_threshold_pct: 75, probability_side: "high" }, action: { amount_usdc: 25, side_selection: "high_prob", max_bets_per_pool: 2 } },
        { condition: { type: "win_probability", probability_threshold_pct: 65, probability_side: "high" }, action: { amount_usdc: 10, side_selection: "high_prob", max_bets_per_pool: 2 } },
        { condition: { type: "win_probability", probability_threshold_pct: 55, probability_side: "high" }, action: { amount_usdc: 3, side_selection: "high_prob", max_bets_per_pool: 2 } },
      ],
      global_constraints: { max_daily_spend_usdc: 100, cooldown_minutes: 20 },
    },
  },
];

server.resource("recipes", "conviction://recipes", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(RECIPES_JSON, null, 2),
    },
  ],
}));

// ── Tool: get_pools ──

server.tool(
  "get_pools",
  "Get all currently open pools. Returns token pairs, pool shares, time remaining, and total pool size. Use this to decide which pools to enter.",
  {},
  async () => {
    const data = (await apiGet("pool-state?mode=open")) as any;
    const pools = data.pools || [];

    if (pools.length === 0) {
      return {
        content: [
          { type: "text", text: "No open pools right now. Pools open daily at 10:00 UTC." },
        ],
      };
    }

    const lines = pools.map((p: any) => {
      const aShare = p.tokenA?.poolSharePercent?.toFixed(1) ?? "50.0";
      const bShare = p.tokenB?.poolSharePercent?.toFixed(1) ?? "50.0";
      const aId = p.tokenA?.id ?? "?";
      const bId = p.tokenB?.id ?? "?";
      const hrs = p.hoursRemaining?.toFixed(1) ?? "?";
      const total = p.totalPoolUsdc?.toFixed(0) ?? "?";

      return [
        `**${p.tokenPairKey}** (${hrs}h left, $${total} pool)`,
        `  ${aId}: ${aShare}% pool ($${p.tokenA?.poolAmount?.toFixed(0) ?? 0})`,
        `  ${bId}: ${bShare}% pool ($${p.tokenB?.poolAmount?.toFixed(0) ?? 0})`,
      ].join("\n");
    });

    return {
      content: [
        {
          type: "text",
          text: `# Open Pools (${pools.length})\n\n${lines.join("\n\n")}\n\n_Use enter_position to enter a pool, or create_agent for automatic strategy execution._`,
        },
      ],
    };
  }
);

// ── Tool: get_pool_history ──

server.tool(
  "get_pool_history",
  "Get historical pool results. Shows past winners, price changes, and pool sizes. Use this to calibrate your strategy.",
  {
    limit: z.number().min(1).max(100).default(20).describe("Number of historical pools to return (max 100)"),
  },
  async ({ limit }) => {
    const data = (await apiGet(`pool-state?mode=history&limit=${limit}`)) as any;
    const pools = data.pools || [];

    if (pools.length === 0) {
      return { content: [{ type: "text", text: "No historical data available yet." }] };
    }

    const lines = pools.map((p: any) => {
      const aChange = p.tokenA?.priceChange24h?.toFixed(2) ?? "?";
      const bChange = p.tokenB?.priceChange24h?.toFixed(2) ?? "?";
      return `${p.tokenPairKey}: Winner=${p.winnerTokenId ?? "?"} | ${p.tokenA?.id}=${aChange}% ${p.tokenB?.id}=${bChange}%`;
    });

    return {
      content: [
        {
          type: "text",
          text: `# Pool History (${pools.length} results)\n\n${lines.join("\n")}\n\n_Use this data to calibrate your betting strategy._`,
        },
      ],
    };
  }
);

// ── Tool: create_agent ──

server.tool(
  "create_agent",
  "Create a new autonomous strategy agent. Gets a funded wallet (500 bsUSD) and API key. The strategy is compiled into executable rules that run automatically every minute. Returns the API key needed for enter_position.",
  {
    name: z.string().optional().describe("Agent display name (optional, defaults to 'Conviction Agent')"),
    strategy: z
      .string()
      .describe(
        'Plain English strategy. Examples: "Enter with $5 on the likely winner when probability > 70%", "Go contrarian: pick the underdog when the pool is 60/40 or worse", "Enter every pool with $2, always pick the token with higher win probability"'
      ),
  },
  async ({ name, strategy }) => {
    if (!strategy || !strategy.trim()) {
      return {
        content: [{ type: "text", text: "Error: strategy is required. Describe how your agent should compete." }],
        isError: true,
      };
    }

    const result = (await apiPost("register-agent", {
      ownerProfileId: "platform_headless",
      agentName: name || "MCP Agent",
      agentDescription: "Created via MCP tool",
      agentRules: strategy,
    })) as any;

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Error creating agent: ${result.error || "Unknown error"}` }],
        isError: true,
      };
    }

    const agent = result.agent || {};
    const compiled = result.compiled || {};
    const airdrop = result.airdrop || {};

    return {
      content: [
        {
          type: "text",
          text: [
            "# Agent Created Successfully",
            "",
            `**Name:** ${agent.name || "MCP Agent"}`,
            `**Wallet:** ${agent.walletAddress || "pending"}`,
            `**API Key:** ${agent.apiKey || "N/A"}`,
            `**Funded:** ${airdrop.funded ? "500 bsUSD" : "Not funded"}`,
            `**Rules Compiled:** ${compiled.success ? `Yes (${compiled.rulesCount} rules)` : "Pending"}`,
            "",
            "Your agent will start executing its strategy automatically every minute.",
            "Use the API key with `enter_position` to also enter pools manually.",
            "",
            "**IMPORTANT: Save your API key. It will not be shown again.**",
          ].join("\n"),
        },
      ],
    };
  }
);

// ── Tool: place_bet ──

server.tool(
  "enter_position",
  "Enter an open pool with a position on one side of a token pair. Requires an agent API key (from create_agent). Earlier entries earn a higher conviction multiplier.",
  {
    api_key: z.string().describe("Agent API key from create_agent (starts with cfm_)"),
    token_a: z.string().describe("First token in the pair (e.g. BTC)"),
    token_b: z.string().describe("Second token in the pair (e.g. ETH)"),
    side: z.string().describe("Which token to pick (e.g. BTC or ETH)"),
    amount: z.number().min(1).default(1).describe("Amount in USDC to commit (minimum 1)"),
  },
  async ({ api_key, token_a, token_b, side, amount }) => {
    const result = (await apiPost("agent-place-bet", {
      agentApiKey: api_key,
      tokenAId: token_a.toUpperCase(),
      tokenBId: token_b.toUpperCase(),
      selectedSide: side.toUpperCase(),
      amountUsdc: amount,
    })) as any;

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Entry failed: ${result.error || "Unknown error"}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: [
            "# Entry Placed",
            "",
            `**Pool:** ${token_a.toUpperCase()}-${token_b.toUpperCase()}`,
            `**Side:** ${side.toUpperCase()}`,
            `**Amount:** $${amount}`,
            `**Conviction Multiplier:** ${result.convictionMultiplier?.toFixed(3) ?? "1.000"}`,
            `**Win Probability:** ${result.winProbability?.toFixed(1) ?? "?"}%`,
            result.explorerUrl ? `**Transaction:** ${result.explorerUrl}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    };
  }
);

// ── Tool: get_leaderboard ──

server.tool(
  "get_leaderboard",
  "Get the strategy performance leaderboard. Shows rankings by net earnings, win rate, and total entries. Use this to benchmark your agent's performance.",
  {
    mode: z
      .enum(["agents", "all", "meta"])
      .default("agents")
      .describe("'agents' = agent-only rankings, 'all' = all users, 'meta' = platform stats"),
  },
  async ({ mode }) => {
    const data = (await apiGet(`leaderboard?mode=${mode}`)) as any;

    if (mode === "meta") {
      return {
        content: [
          {
            type: "text",
            text: `# Platform Stats\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }

    const rankings = data.rankings || [];
    if (rankings.length === 0) {
      return { content: [{ type: "text", text: "No rankings data available." }] };
    }

    const lines = rankings.slice(0, 20).map((r: any) => {
      const profit =
        r.netProfit >= 0 ? `+$${r.netProfit.toFixed(2)}` : `-$${Math.abs(r.netProfit).toFixed(2)}`;
      return `#${r.rank} ${r.displayName} | ${profit} | ${r.totalBets} bets | ${r.winRate}% win`;
    });

    return {
      content: [
        {
          type: "text",
          text: `# Agent Leaderboard (Top ${Math.min(rankings.length, 20)})\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ── Tool: update_strategy ──

server.tool(
  "update_strategy",
  "Update an agent's strategy. The new rules will be recompiled automatically. Requires the agent's ID and owner profile ID.",
  {
    agent_id: z.string().describe("The agent's profile ID (e.g. agent_abc123...)"),
    owner_id: z.string().describe("The owner's profile ID who created this agent"),
    new_rules: z.string().describe("New natural language strategy to replace the current one"),
  },
  async ({ agent_id, owner_id, new_rules }) => {
    const result = (await apiPost("update-agent", {
      action: "update_rules",
      agentId: agent_id,
      ownerProfileId: owner_id,
      newRules: new_rules,
    })) as any;

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Update failed: ${result.error || "Unknown error"}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: [
            "# Strategy Updated",
            "",
            `**Agent:** ${agent_id}`,
            `**New Rules:** ${result.rules || new_rules}`,
            `**Compiled:** ${result.compiled?.success ? `Yes (${result.compiled.rulesCount} rules)` : "Failed — will retry"}`,
            "",
            result.message || "",
          ].join("\n"),
        },
      ],
    };
  }
);

// ── Tool: toggle_agent ──

server.tool(
  "toggle_agent",
  "Pause or resume an agent's automatic strategy execution. When paused, the agent stops entering pools via cron. Manual entries via enter_position still work.",
  {
    agent_id: z.string().describe("The agent's profile ID"),
    owner_id: z.string().describe("The owner's profile ID who created this agent"),
  },
  async ({ agent_id, owner_id }) => {
    const result = (await apiPost("update-agent", {
      action: "toggle",
      agentId: agent_id,
      ownerProfileId: owner_id,
    })) as any;

    if (!result.success) {
      return {
        content: [{ type: "text", text: `Toggle failed: ${result.error || "Unknown error"}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Agent **${agent_id}** is now **${result.active ? "ACTIVE" : "PAUSED"}**. ${result.message || ""}`,
        },
      ],
    };
  }
);

// ─── Start Server ────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
