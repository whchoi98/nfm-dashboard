import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export const dynamic = 'force-dynamic';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const COLLECTOR_FN = process.env.COLLECTOR_FUNCTION ?? 'nfm-dashboard-collector';

let client: LambdaClient | undefined;

export async function POST() {
  try {
    client ??= new LambdaClient({ region: REGION });
    await client.send(new InvokeCommand({ FunctionName: COLLECTOR_FN, InvocationType: 'Event' }));
    return Response.json({ triggered: true });
  } catch (e) {
    console.error('[api/nfm/refresh]', e);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
