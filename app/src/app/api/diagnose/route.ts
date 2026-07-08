import { NextRequest } from 'next/server';
import { sendConverseStream, MODEL_ID } from '@/lib/bedrock';
import { getTopology, getCollectionStatus } from '@/lib/ddb';
import { buildDiagnoseContext, topAnomalies } from '@/lib/diagnose-context';
import { sseEvent } from '@/lib/sse';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { focus?: string; lang?: 'ko' | 'en'; regenerate?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { focus, regenerate = false } = body;
  const lang = body.lang === 'en' ? 'en' : 'ko';

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
      let modelUsed = MODEL_ID;
      try {
        send('status', { stage: 'analyzing' });
        const [topology, status] = await Promise.all([getTopology(), getCollectionStatus()]);
        const context = buildDiagnoseContext(topology, status, topAnomalies(topology));

        const system = [{ text: [
          'You are a senior network-operations diagnostician for an AWS NFM (Network Flow Monitor)',
          ' dashboard that monitors EKS/EC2 traffic. The user message contains the latest topology',
          ' summary, collection status and top anomaly edges (ranked by retransmissions+timeouts).',
          ' Diagnose overall network health, explicitly call out the most significant anomalies',
          ' (cite concrete edges, endpoints and metric values from the context; consider the',
          ' INTRA_AZ/INTER_AZ/INTER_VPC category), give the most likely causes, and suggest',
          ' concrete next checks (specific pods/edges to drill into, AWS resources to inspect).',
          ' If the context says data is still collecting (수집 준비 중), say the data is not ready',
          ' yet and do not invent findings.',
          ` Answer in ${lang === 'ko' ? 'Korean' : 'English'}.`,
          regenerate
            ? ' This is a regeneration request: 이전 진단과 다른 관점으로 분석하십시오 — take a'
              + ' different analytical angle than a previous pass over the same data (different'
              + ' anomalies, hypotheses, or checks to emphasize).'
            : '',
          focus ? ` Focus the diagnosis on: ${focus}` : '',
        ].join('') }];

        const userText = focus
          ? `${context}\n\n## 진단 포커스 / Focus\n${focus}`
          : context;
        const { response: res, modelId } = await sendConverseStream({
          system,
          messages: [{ role: 'user', content: [{ text: userText }] }],
        });
        modelUsed = modelId;

        let full = '';
        for await (const ev of res.stream!) {
          if (ev.contentBlockDelta?.delta?.text) {
            full += ev.contentBlockDelta.delta.text;
            send('chunk', { delta: ev.contentBlockDelta.delta.text });
          }
        }
        send('done', { content: full, elapsedMs: Date.now() - t0, model: modelUsed, regenerate });
      } catch (e) {
        console.error('[api/diagnose]', e);
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
