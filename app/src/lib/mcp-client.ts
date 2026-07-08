/**
 * SigV4-signed MCP (JSON-RPC 2.0 over streamable HTTP) client for the
 * AgentCore gateway (authorizer AWS_IAM — unsigned requests get 401).
 * TS equivalent of awsops streamable_http_sigv4.py.
 */
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const SERVICE = 'bedrock-agentcore';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface BedrockTool {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

let signer: SignatureV4 | undefined;
function getSigner(): SignatureV4 {
  return (signer ??= new SignatureV4({
    service: SERVICE,
    region: REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  }));
}

let rpcId = 0;

/** JSON-RPC 2.0 POST, SigV4-signed for bedrock-agentcore. Returns `result`, throws on `error`. */
export async function mcpCall(
  url: string,
  method: 'tools/list' | 'tools/call',
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const u = new URL(url);
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) });
  const unsigned = new HttpRequest({
    method: 'POST',
    protocol: u.protocol,
    hostname: u.hostname,
    path: u.pathname,
    headers: {
      host: u.hostname,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body,
  });
  const signed = await getSigner().sign(unsigned);
  const res = await fetch(url, { method: 'POST', headers: signed.headers as Record<string, string>, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 500)}`);

  // Streamable HTTP may answer as JSON or as an SSE body — handle both.
  let payload: { result?: Record<string, unknown>; error?: { code?: number; message?: string } };
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:'));
    const last = dataLines[dataLines.length - 1];
    if (!last) throw new Error(`MCP ${method}: empty SSE response`);
    payload = JSON.parse(last.slice(5).trim());
  } else {
    payload = JSON.parse(text);
  }
  if (payload.error) {
    throw new Error(`MCP ${method} error ${payload.error.code ?? ''}: ${payload.error.message ?? 'unknown'}`);
  }
  return payload.result ?? {};
}

const toolsCache = new Map<string, { tools: McpTool[]; at: number }>();

/** List gateway tools (paginated via nextCursor), 5-minute module cache. */
export async function listTools(url: string): Promise<McpTool[]> {
  const hit = toolsCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tools;
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const result = await mcpCall(url, 'tools/list', cursor ? { cursor } : undefined);
    tools.push(...((result.tools as McpTool[] | undefined) ?? []));
    cursor = result.nextCursor as string | undefined;
  } while (cursor);
  toolsCache.set(url, { tools, at: Date.now() });
  return tools;
}

/** Call a gateway tool; returns the first text content block. */
export async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await mcpCall(url, 'tools/call', {
    name: restoreToolName(name),
    arguments: args,
  });
  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  const textItem = content?.find((c) => typeof c.text === 'string');
  if (textItem?.text !== undefined) return textItem.text;
  return JSON.stringify(result);
}

// Bedrock tool names must match [a-zA-Z0-9_-]{1,64}. Gateway names are
// `<target>___<tool>` and normally fit, but if one exceeds 64 chars we
// truncate for Bedrock and keep a map to restore the original for tools/call.
const truncatedNameMap = new Map<string, string>();

function toBedrockName(name: string): string {
  let out = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (out.length > 64) out = out.slice(0, 64);
  if (out !== name) {
    // Disambiguate truncation collisions (two long names sharing a 64-char prefix).
    let candidate = out;
    let n = 1;
    while (truncatedNameMap.has(candidate) && truncatedNameMap.get(candidate) !== name) {
      const suffix = `_${n++}`;
      candidate = out.slice(0, 64 - suffix.length) + suffix;
    }
    truncatedNameMap.set(candidate, name);
    out = candidate;
  }
  return out;
}

/** Restore an original MCP tool name from a (possibly truncated) Bedrock name. */
export function restoreToolName(bedrockName: string): string {
  return truncatedNameMap.get(bedrockName) ?? bedrockName;
}

/** Map MCP tools to Bedrock Converse toolConfig.tools (names kept verbatim incl. `___`). */
export function toBedrockTools(mcpTools: McpTool[]): BedrockTool[] {
  return mcpTools.map((t) => ({
    toolSpec: {
      name: toBedrockName(t.name),
      description: t.description || t.name,
      inputSchema: { json: t.inputSchema },
    },
  }));
}
