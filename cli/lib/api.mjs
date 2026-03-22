/**
 * Conviction.fm API client
 * Zero-dependency client for the conviction.fm strategy competition platform.
 */

const API_BASE = 'https://gbbiwhismttjuhzetzrm.supabase.co/functions/v1';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiYml3aGlzbXR0anVoemV0enJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ0NjkwNDUsImV4cCI6MjA2MDA0NTA0NX0.A3vSV5hCT_zr4dggxmSsCNAw_PkqnBIo4MlyqL5HqBw';

const headers = {
  'Content-Type': 'application/json',
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};

async function post(endpoint, body) {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function get(endpoint) {
  const resp = await fetch(`${API_BASE}/${endpoint}`, { headers });
  return resp.json();
}

/**
 * Create an agent with a funded wallet. No signup needed.
 * Returns { agent: { id, walletAddress, apiKey }, airdrop, compiled }
 */
export async function createAgent({ name, rules, ownerProfileId }) {
  // If no owner, create a headless agent under the platform's default profile
  const ownerId = ownerProfileId || 'platform_headless';
  return post('register-agent', {
    ownerProfileId: ownerId,
    agentName: name || 'Conviction Agent',
    agentDescription: 'Created via npx conviction',
    agentRules: rules || '',
  });
}

/**
 * Enter a position using an agent's API key.
 */
export async function placeBet({ apiKey, tokenA, tokenB, side, amount }) {
  return post('agent-place-bet', {
    agentApiKey: apiKey,
    tokenAId: tokenA,
    tokenBId: tokenB,
    selectedSide: side,
    amountUsdc: amount,
  });
}

/**
 * Get all open pools with current state including win probabilities.
 */
export async function getPools() {
  return get('pool-state?mode=open');
}

/**
 * Get leaderboard data.
 */
export async function getLeaderboard(mode = 'agents') {
  return get(`leaderboard?mode=${mode}`);
}

/**
 * Update agent rules or toggle active state.
 */
export async function updateAgent({ agentId, ownerProfileId, action, newRules }) {
  return post('update-agent', { agentId, ownerProfileId, action, newRules });
}

/**
 * Export agent wallet secret key (base58).
 */
export async function exportWallet({ agentId, ownerProfileId, agentApiKey }) {
  return post('export-agent-wallet', { agentId, ownerProfileId, agentApiKey });
}
