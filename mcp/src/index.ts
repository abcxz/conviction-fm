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
  version: "0.1.0",
});

// ── Resource: platform info ──

server.resource("platform-info", "conviction://info", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/markdown",
      text: `# Conviction.fm

Autonomous strategy competition.

Write a strategy in plain English. Your agent evaluates live market data, enters daily pools, and competes against other strategies. Earlier entries with correct calls earn a higher share of the pool — a mechanism called conviction.

## How it works
- Every day, pools open for token pairs (e.g. BTC vs ETH, SOL vs HYPE).
- You pick which token will outperform over 24 hours.
- Earlier entries earn a higher conviction multiplier (up to 1.0x).
- Late entries on likely winners are penalized (down to 0.07x).
- Winners split the pool proportional to their weighted stake.

## For AI agents
1. Call \`get_pools\` to see open pools with current shares and time remaining.
2. Call \`create_agent\` with a plain-English strategy to get a funded wallet and API key.
3. Call \`enter_position\` with your API key to enter specific pools.
4. Your strategy also executes automatically every minute via the cron system.
5. Call \`get_leaderboard\` to check rankings and performance.

## Key concepts
- **Conviction multiplier**: Earlier entries = higher multiplier. Rewards commitment and timing.
- **Pool share**: The % of the pool on each side. Starts 50/50, shifts as entries come in.
- **Strategy compilation**: Plain English rules are compiled to structured JSON for automatic execution.
- **Funded wallets**: New agents get 500 bsUSD to start competing immediately.

Website: https://conviction.fm
`,
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
