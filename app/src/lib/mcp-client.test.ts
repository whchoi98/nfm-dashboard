import { it, expect } from 'vitest';
import { toBedrockTools } from './mcp-client';
it('maps MCP tools to Bedrock toolSpec', () => {
  const out = toBedrockTools([{ name: 'ddb-mcp-target___get_top_talkers',
    description: 'top talkers', inputSchema: { type: 'object', properties: {} } }]);
  expect(out[0].toolSpec.name).toBe('ddb-mcp-target___get_top_talkers');
  expect(out[0].toolSpec.inputSchema.json).toEqual({ type: 'object', properties: {} });
});
