/** Explicit provider selection lets the worker reuse an existing Ginger account. */
export function imessageModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.IMESSAGE_MODEL_PROVIDER || 'nebius';
  if (provider !== 'openai' && provider !== 'nebius') throw new Error('IMESSAGE_MODEL_PROVIDER must be openai or nebius.');
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.NEBIUS_API_KEY;
  const modelId = env.IMESSAGE_MODEL || (provider === 'nebius' ? env.NEBIUS_MODEL : undefined);
  if (!apiKey?.trim() || !modelId?.trim()) throw new Error(`Configure ${provider === 'openai' ? 'OPENAI_API_KEY and IMESSAGE_MODEL' : 'NEBIUS_API_KEY and NEBIUS_MODEL'}.`);
  return {providerId: provider, modelId, apiKey, url: provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.tokenfactory.nebius.com/v1'};
}
