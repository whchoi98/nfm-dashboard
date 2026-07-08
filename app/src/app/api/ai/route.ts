import { NextRequest } from 'next/server';
import type { ContentBlock, Message, Tool } from '@aws-sdk/client-bedrock-runtime';
import { sendConverseStream, MODEL_ID } from '@/lib/bedrock';
import { listTools, callTool, toBedrockTools } from '@/lib/mcp-client';
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
  const { messages, lang = 'ko' } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 });
  }

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
        const gatewayUrl = await getParam('/nfm-dashboard/gateway-url');
        let tools: ReturnType<typeof toBedrockTools> = [];
        try { tools = toBedrockTools(await listTools(gatewayUrl)); }
        catch (e) {
          console.error('[api/ai] gateway listTools failed — tool-less fallback:', e);
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
          const toolUses: { toolUseId: string; name: string; input: string }[] = [];
          let stopReason = '';
          let text = '';
          for await (const ev of res.stream!) {
            if (ev.contentBlockStart?.start?.toolUse) {
              const t = ev.contentBlockStart.start.toolUse;
              toolUses.push({ toolUseId: t.toolUseId!, name: t.name!, input: '' });
            } else if (ev.contentBlockDelta?.delta?.text) {
              text += ev.contentBlockDelta.delta.text;
              send('chunk', { delta: ev.contentBlockDelta.delta.text });
            } else if (ev.contentBlockDelta?.delta?.toolUse?.input) {
              toolUses[toolUses.length - 1].input += ev.contentBlockDelta.delta.toolUse.input;
            } else if (ev.messageStop) stopReason = ev.messageStop.stopReason ?? '';
          }
          full += text;
          if (stopReason !== 'tool_use') break;
          const assistantContent: ContentBlock[] = [];
          if (text) assistantContent.push({ text });
          for (const tu of toolUses) {
            assistantContent.push({ toolUse: { toolUseId: tu.toolUseId,
              name: tu.name, input: JSON.parse(tu.input || '{}') } });
          }
          convo.push({ role: 'assistant', content: assistantContent });
          const results: ContentBlock[] = [];
          for (const tu of toolUses) {
            usedTools.push(tu.name);
            send('status', { stage: `tool:${tu.name}` });
            let out: string;
            // callTool restores the original MCP name if Bedrock's was truncated.
            try { out = await callTool(gatewayUrl, tu.name, JSON.parse(tu.input || '{}')); }
            catch (e) { out = `tool error: ${(e as Error).message}`; }
            results.push({ toolResult: { toolUseId: tu.toolUseId,
              content: [{ text: out.slice(0, 40000) }] } });
          }
          convo.push({ role: 'user', content: results });
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
