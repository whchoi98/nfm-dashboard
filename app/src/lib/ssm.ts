import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const CACHE_TTL_MS = 5 * 60 * 1000;

let client: SSMClient | undefined;
const cache = new Map<string, { value: string; at: number }>();

/**
 * Read an SSM parameter (SecureString supported — always WithDecryption),
 * with a 5-minute module-level cache.
 */
export async function getParam(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  client ??= new SSMClient({ region: REGION });
  const res = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  cache.set(name, { value, at: Date.now() });
  return value;
}
