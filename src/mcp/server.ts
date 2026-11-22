import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

function getBaseUrl(): string {
  const envUrl = process.env.MCP_TARGET_URL;
  if (envUrl) {
    // Only use env if it's localhost/127.0.0.1 with numeric port
    try {
      const url = new URL(envUrl);
      const hostname = url.hostname;
      const port = url.port;
      const isLocalhost = hostname === '127.0.0.1' || hostname === 'localhost';
      const isNumericPort = /^\d+$/.test(port);
      if (isLocalhost && isNumericPort) {
        return envUrl;
      }
    } catch {
      // Invalid URL, fall through to default
    }
  }
  return 'http://127.0.0.1:3000';
}

const HTTP_BASE_URL = getBaseUrl();

// Private token storage per marketId
const marketTokens = new Map<string, string>();
// Cached inbound per alias per marketId: providerMessageId + original text
const inboundCache = new Map<string, Map<string, { providerMessageId: string; text: string }>>();

const DEMO_TOOLS = {
  market_create: {
    name: 'market_create',
    description: 'Create a new demo market with seed traders and products',
    inputSchema: {
      marketName: z.string().min(1).max(100),
      seedTraders: z.array(z.string()).optional(),
    },
  },
  market_send: {
    name: 'market_send',
    description: 'Send an inbound message to a demo market',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
      alias: z.string().min(1),
      text: z.string().min(1),
      providerMessageId: z.string().min(1),
    },
  },
  market_send_duplicate: {
    name: 'market_send_duplicate',
    description: 'Send a duplicate inbound message to test idempotency',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
      alias: z.string().min(1),
      text: z.string().optional(),
    },
  },
  market_send_late: {
    name: 'market_send_late',
    description: 'Send a late inbound message to test time handling',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
      alias: z.string().min(1),
      text: z.string().min(1),
      minutes: z.number().int().min(0),
    },
  },
  market_advance_clock: {
    name: 'market_advance_clock',
    description: 'Advance the demo market clock by minutes',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
      minutes: z.number().int().min(0),
    },
  },
  market_state: {
    name: 'market_state',
    description: 'Get the current state of a demo market',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
    },
  },
  market_events: {
    name: 'market_events',
    description: 'Get all domain events for a demo market',
    inputSchema: {
      marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/),
    },
  },
  market_shortages: {
    name: 'market_shortages',
    description: 'Read aggregate shortages in a demo market',
    inputSchema: { marketId: z.string().regex(/^demo_[0-9a-f-]{36}$/) },
  },
} as const;

type ToolKey = keyof typeof DEMO_TOOLS;

const server = new McpServer({
  name: 'market-wire',
  version: '0.1.0',
});

function getToken(marketId: string): string {
  const token = marketTokens.get(marketId);
  if (!token) {
    throw new Error('Unknown marketId');
  }
  return token;
}

function getAuthHeaders(marketId: string): Record<string, string> {
  const token = getToken(marketId);
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status}: ${err}`);
  }
  return response.json() as Promise<T>;
}

function createToolHandler(toolKey: ToolKey) {
  return async (params: unknown) => {
    const tool = DEMO_TOOLS[toolKey];
    const schema = z.object(tool.inputSchema as Record<string, z.ZodTypeAny>);
    const parsed = schema.parse(params);

    try {
      switch (toolKey) {
        case 'market_create': {
          const body = {
            name: (parsed as { marketName: string }).marketName,
            traders: (parsed as { seedTraders?: string[] }).seedTraders,
          };
          const result = await fetchApi<{ marketId: string; token: string }>(
            `${HTTP_BASE_URL}/api/demo/markets`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          // Store token privately by marketId
          marketTokens.set(result.marketId, result.token);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ marketId: result.marketId }, null, 2) }] };
        }

        case 'market_send': {
          const p = parsed as { marketId: string; alias: string; text: string; providerMessageId: string };
          const body = {
            alias: p.alias,
            text: p.text,
            providerMessageId: p.providerMessageId,
          };
          const result = await fetchApi<{ messageId: string }>(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/inbound`,
            {
              method: 'POST',
              headers: getAuthHeaders(p.marketId),
              body: JSON.stringify(body),
            }
          );
          // Save last inbound for this alias
          let aliasMap = inboundCache.get(p.marketId);
          if (!aliasMap) {
            aliasMap = new Map();
            inboundCache.set(p.marketId, aliasMap);
          }
          aliasMap.set(p.alias, { providerMessageId: p.providerMessageId, text: p.text });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        case 'market_send_duplicate': {
          const p = parsed as { marketId: string; alias: string; text?: string };
          const aliasMap = inboundCache.get(p.marketId);
          if (!aliasMap) {
            throw new Error('No previous message for this market');
          }
          const cached = aliasMap.get(p.alias);
          if (!cached) {
            throw new Error(`No previous message for alias "${p.alias}"`);
          }
          const body = {
            alias: p.alias,
            providerMessageId: cached.providerMessageId,
            text: p.text ?? cached.text,
          };
          const result = await fetchApi<{ messageId: string }>(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/inbound`,
            {
              method: 'POST',
              headers: getAuthHeaders(p.marketId),
              body: JSON.stringify(body),
            }
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        case 'market_send_late': {
          const p = parsed as { marketId: string; alias: string; text: string; minutes: number };
          // First advance clock
          await fetchApi(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/clock`,
            {
              method: 'POST',
              headers: getAuthHeaders(p.marketId),
              body: JSON.stringify({ minutes: p.minutes }),
            }
          );
          // Then send inbound
          const body = {
            alias: p.alias,
            text: p.text,
            providerMessageId: `late-${Date.now()}`,
          };
          const result = await fetchApi<{ messageId: string }>(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/inbound`,
            {
              method: 'POST',
              headers: getAuthHeaders(p.marketId),
              body: JSON.stringify(body),
            }
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        case 'market_advance_clock': {
          const p = parsed as { marketId: string; minutes: number };
          await fetchApi(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/clock`,
            {
              method: 'POST',
              headers: getAuthHeaders(p.marketId),
              body: JSON.stringify({ minutes: p.minutes }),
            }
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify({ advanced: p.minutes }, null, 2) }] };
        }

        case 'market_shortages':
        case 'market_state': {
          const p = parsed as { marketId: string };
          const result = await fetchApi<Record<string, unknown>>(
            `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/${toolKey === 'market_state' ? 'state' : 'shortages'}`,
            { headers: getAuthHeaders(p.marketId) }
          );
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        case 'market_events': {
          const p = parsed as { marketId: string };
          let result: Record<string, unknown>;
          try {
            result = await fetchApi<Record<string, unknown>>(
              `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/events`,
              { headers: getAuthHeaders(p.marketId) }
            );
          } catch {
            // Fallback to message history if events endpoint absent
            result = await fetchApi<Record<string, unknown>>(
              `${HTTP_BASE_URL}/api/demo/markets/${p.marketId}/messages`,
              { headers: getAuthHeaders(p.marketId) }
            );
            result = { messageHistory: result };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        default: {
          const _exhaustive: never = toolKey;
          throw new Error(`Unknown tool: ${_exhaustive}`);
        }
      }
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${String(error)}` }],
        isError: true,
      };
    }
  };
}

// Register tools using raw zod shape (MCP SDK v1.29+)
server.registerTool(DEMO_TOOLS.market_create.name, {
  description: DEMO_TOOLS.market_create.description,
  inputSchema: DEMO_TOOLS.market_create.inputSchema,
}, createToolHandler('market_create'));

server.registerTool(DEMO_TOOLS.market_send.name, {
  description: DEMO_TOOLS.market_send.description,
  inputSchema: DEMO_TOOLS.market_send.inputSchema,
}, createToolHandler('market_send'));

server.registerTool(DEMO_TOOLS.market_send_duplicate.name, {
  description: DEMO_TOOLS.market_send_duplicate.description,
  inputSchema: DEMO_TOOLS.market_send_duplicate.inputSchema,
}, createToolHandler('market_send_duplicate'));

server.registerTool(DEMO_TOOLS.market_send_late.name, {
  description: DEMO_TOOLS.market_send_late.description,
  inputSchema: DEMO_TOOLS.market_send_late.inputSchema,
}, createToolHandler('market_send_late'));

server.registerTool(DEMO_TOOLS.market_advance_clock.name, {
  description: DEMO_TOOLS.market_advance_clock.description,
  inputSchema: DEMO_TOOLS.market_advance_clock.inputSchema,
}, createToolHandler('market_advance_clock'));

server.registerTool(DEMO_TOOLS.market_state.name, {
  description: DEMO_TOOLS.market_state.description,
  inputSchema: DEMO_TOOLS.market_state.inputSchema,
}, createToolHandler('market_state'));

server.registerTool(DEMO_TOOLS.market_events.name, {
  description: DEMO_TOOLS.market_events.description,
  inputSchema: DEMO_TOOLS.market_events.inputSchema,
}, createToolHandler('market_events'));

server.registerTool(DEMO_TOOLS.market_shortages.name, {
  description: DEMO_TOOLS.market_shortages.description,
  inputSchema: DEMO_TOOLS.market_shortages.inputSchema,
}, createToolHandler('market_shortages'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Market Wire MCP server running on stdio');
}

main().catch((error) => {
  console.error(`Fatal error in MCP server: ${error}`);
  process.exit(1);
});
