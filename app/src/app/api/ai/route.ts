import { NextRequest } from 'next/server';
import type { ContentBlock, Message, Tool, ToolUseBlock } from '@aws-sdk/client-bedrock-runtime';
import { sendConverseStream, MODEL_ID } from '@/lib/bedrock';
import { listTools, callTool, toBedrockTools } from '@/lib/mcp-client';
import { generateFollowups } from '@/lib/followups';
import { sseEvent } from '@/lib/sse';
import { getParam } from '@/lib/ssm'; // /nfm-dashboard/gateway-url cached lookup

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[]; lang?: 'ko' | 'en' };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 });
  }
  // lang: explicit body field, else Accept-Language, else 'ko'.
  const lang: 'ko' | 'en' = body.lang === 'en' || body.lang === 'ko'
    ? body.lang
    : (req.headers.get('accept-language') ?? '').toLowerCase().startsWith('en') ? 'en' : 'ko';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (e: string, d: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseEvent(e, d))); } catch { closed = true; }
      };
      const ka = setInterval(() => send('status', { stage: 'keepalive' }), 15000);
      const t0 = Date.now();
      const usedTools: string[] = [];
      let modelUsed = MODEL_ID;
      try {
        send('status', { stage: 'connecting' });
        // Gateway URL fetch + listTools + toBedrockTools together: an SSM or
        // gateway outage degrades to a tool-less answer, never a hard error.
        let gatewayUrl = '';
        let tools: ReturnType<typeof toBedrockTools> = [];
        try {
          gatewayUrl = await getParam('/nfm-dashboard/gateway-url');
          tools = toBedrockTools(await listTools(gatewayUrl));
        } catch (e) {
          console.error('[api/ai] gateway setup failed — tool-less fallback:', e);
          send('status', { stage: 'fallback' });
        }
        const system = [{ text: `You are an AWS network operations assistant for an NFM (Network Flow Monitor) dashboard. Use tools to inspect flows, pods, paths and AWS network resources. Answer in ${lang === 'ko' ? 'Korean' : 'English'}. Cite concrete values from tool results.` }];
        const convo: Message[] = messages.map((m) => ({
          role: m.role,
          content: [{ text: m.content }],
        }));
        let full = '';
        for (let turn = 0; turn < 8; turn++) {
          const { response: res, modelId } = await sendConverseStream({
            modelId: modelUsed,
            system,
            messages: convo,
            // BedrockTool matches the Tool.ToolSpecMember wire shape (plain JSON, no $unknown).
            ...(tools.length ? { toolConfig: { tools: tools as unknown as Tool[] } } : {}),
          });
          modelUsed = modelId; // stick with the fallback once engaged
          // Track tool-use blocks by contentBlockIndex so each delta maps to
          // its block deterministically (a delta arriving without a preceding
          // contentBlockStart must not crash the stream).
          const toolUseByIndex = new Map<number, { toolUseId: string; name: string; input: string }>();
          let lastToolUseIdx = -1;
          let stopReason = '';
          let text = '';
          for await (const ev of res.stream!) {
            if (ev.contentBlockStart?.start?.toolUse) {
              const t = ev.contentBlockStart.start.toolUse;
              const idx = ev.contentBlockStart.contentBlockIndex ?? lastToolUseIdx + 1;
              lastToolUseIdx = idx;
              const blk = toolUseByIndex.get(idx) ?? { toolUseId: '', name: '', input: '' };
              blk.toolUseId = t.toolUseId ?? blk.toolUseId;
              blk.name = t.name ?? blk.name;
              toolUseByIndex.set(idx, blk);
            } else if (ev.contentBlockDelta?.delta?.text) {
              text += ev.contentBlockDelta.delta.text;
              send('chunk', { delta: ev.contentBlockDelta.delta.text });
            } else if (ev.contentBlockDelta?.delta?.toolUse?.input !== undefined) {
              const idx = ev.contentBlockDelta.contentBlockIndex ?? lastToolUseIdx;
              let blk = toolUseByIndex.get(idx);
              if (!blk) { // delta without a started block — create lazily, never crash
                blk = { toolUseId: '', name: '', input: '' };
                toolUseByIndex.set(idx, blk);
              }
              blk.input += ev.contentBlockDelta.delta.toolUse.input;
            } else if (ev.messageStop) stopReason = ev.messageStop.stopReason ?? '';
          }
          // Ordered list at messageStop; a lazily-created block that never got
          // an id/name cannot be echoed back to Bedrock, so drop it.
          const toolUses = [...toolUseByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, blk]) => blk)
            .filter((blk) => blk.toolUseId && blk.name);
          full += text;
          if (stopReason !== 'tool_use') break;
          const assistantContent: ContentBlock[] = [];
          if (text) assistantContent.push({ text });
          const results: ContentBlock[] = [];
          for (const tu of toolUses) {
            usedTools.push(tu.name);
            send('status', { stage: `tool:${tu.name}` });
            // Per-tool isolation: parse the input once, reuse it for both the
            // assistant toolUse block and the call; any failure becomes a
            // toolResult error for THIS tool only — never abort the stream.
            let input: Record<string, unknown> = {};
            let out: string | undefined;
            try { input = JSON.parse(tu.input || '{}'); }
            catch (e) { out = `tool error: invalid tool input JSON: ${(e as Error).message}`; }
            // Every toolResult needs a matching toolUse block, even on failure.
            assistantContent.push({ toolUse: { toolUseId: tu.toolUseId, name: tu.name,
              input: input as ToolUseBlock['input'] } });
            if (out === undefined) {
              // callTool restores the original MCP name if Bedrock's was truncated.
              try { out = await callTool(gatewayUrl, tu.name, input); }
              catch (e) { out = `tool error: ${(e as Error).message}`; }
            }
            results.push({ toolResult: { toolUseId: tu.toolUseId,
              content: [{ text: out.slice(0, 40000) }] } });
          }
          convo.push({ role: 'assistant', content: assistantContent });
          convo.push({ role: 'user', content: results });
        }
        // Follow-up suggestions: only for a non-empty answer, emitted BEFORE
        // done. generateFollowups never throws (any failure → []); the
        // keepalive stays running through this call.
        if (full.trim()) {
          const lastUserMessage =
            [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
          const fu = await generateFollowups(full, lastUserMessage, lang);
          if (fu.length) send('followups', { questions: fu });
        }
        send('done', { content: full, usedTools, elapsedMs: Date.now() - t0, model: modelUsed });
      } catch (e) {
        console.error('[api/ai]', e);
        send('error', { message: (e as Error).message });
      } finally {
        clearInterval(ka);
        if (!closed) { try { controller.close(); } catch { /* already closed */ } }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
