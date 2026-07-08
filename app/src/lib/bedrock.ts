import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

export const MODEL_ID = 'global.anthropic.claude-sonnet-5';
export const FALLBACK_MODEL_ID = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

/** BedrockRuntimeClient singleton (ap-northeast-2). */
export const bedrock = new BedrockRuntimeClient({ region: REGION });

/** Model-unavailable / identifier-validation errors that warrant the fallback model. */
function isModelUnavailable(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  const name = err?.name ?? '';
  const msg = err?.message ?? '';
  if (name === 'ResourceNotFoundException' || name === 'ModelNotReadyException') return true;
  if (name === 'ValidationException' && /model/i.test(msg)) return true;
  if (name === 'AccessDeniedException' && /model/i.test(msg)) return true;
  return false;
}

/**
 * ConverseStream with MODEL_ID, retrying once with FALLBACK_MODEL_ID when the
 * primary model is unavailable. Returns the response plus the model actually used.
 */
export async function sendConverseStream(
  params: Omit<ConverseStreamCommandInput, 'modelId'> & { modelId?: string },
): Promise<{ response: ConverseStreamCommandOutput; modelId: string }> {
  const primary = params.modelId ?? MODEL_ID;
  try {
    const response = await bedrock.send(new ConverseStreamCommand({ ...params, modelId: primary }));
    return { response, modelId: primary };
  } catch (e) {
    if (primary !== FALLBACK_MODEL_ID && isModelUnavailable(e)) {
      console.warn(`[bedrock] model ${primary} unavailable (${(e as Error).message}) — falling back to ${FALLBACK_MODEL_ID}`);
      const response = await bedrock.send(
        new ConverseStreamCommand({ ...params, modelId: FALLBACK_MODEL_ID }),
      );
      return { response, modelId: FALLBACK_MODEL_ID };
    }
    throw e;
  }
}
