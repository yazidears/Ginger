import 'server-only';

type Message = {role: 'user' | 'assistant'; content: string};
export function sageConfiguration() {
  const selected = process.env.SAGE_PROVIDER?.trim() || 'openai';
  const provider = selected === 'nebius' ? 'nebius' : 'openai';
  const model = provider === 'nebius' ? process.env.NEBIUS_MODEL?.trim() || '' : process.env.SAGE_MODEL?.trim() || 'gpt-6-astra';
  const key = provider === 'nebius' ? process.env.NEBIUS_API_KEY : process.env.OPENAI_API_KEY;
  return {provider, model, configured: ['openai', 'nebius'].includes(selected) && Boolean(key?.trim() && model)} as const;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function completedAnswer(data: unknown, provider: 'openai' | 'nebius'): string {
  const result = object(data);
  let answer: string;
  if (provider === 'nebius') {
    const choices = result.choices;
    if (!Array.isArray(choices) || choices.length !== 1) throw Error('Model analysis incomplete');
    const choice = object(choices[0]);
    const message = object(choice.message);
    if (choice.finish_reason !== 'stop' || message.role !== 'assistant' || message.refusal || message.tool_calls || typeof message.content !== 'string') throw Error('Model analysis incomplete');
    // Reasoning models can return a separate reasoning_content field. Never publish it.
    answer = message.content.trim();
    if (/<\/?(?:think|analysis)\b/i.test(answer)) throw Error('Model analysis unavailable');
  } else {
    if (result.status !== 'completed' || !Array.isArray(result.output)) throw Error('Model analysis incomplete');
    const messages = result.output.map(object).filter(item => item.type === 'message' && item.role === 'assistant');
    if (messages.some(item => item.status && item.status !== 'completed')) throw Error('Model analysis incomplete');
    const parts = messages.flatMap(item => Array.isArray(item.content) ? item.content.map(object) : []);
    if (parts.some(part => part.type === 'refusal')) throw Error('Model analysis unavailable');
    answer = parts.filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();
  }
  if (!answer || answer.length > 16000) throw Error('Model analysis unavailable');
  return answer;
}

/** Both providers receive the same grounded instructions and evidence. Keys stay on the server. */
export async function requestSageCompletion({instructions, input, signal}: {instructions: string; input: Message[]; signal?: AbortSignal}) {
  const config = sageConfiguration();
  if (!config.configured) throw Error('Sage is not configured');
  const nebius = config.provider === 'nebius';
  let response: Response;
  try {
    response = await fetch(nebius ? 'https://api.tokenfactory.nebius.com/v1/chat/completions' : 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${(nebius ? process.env.NEBIUS_API_KEY : process.env.OPENAI_API_KEY)!.trim()}`},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
      cache: 'no-store',
      body: JSON.stringify(nebius
        ? {model: config.model, max_tokens: 5000, stream: false, messages: [{role: 'system', content: instructions}, ...input]}
        : {model: config.model, store: false, max_output_tokens: 5000, instructions, input}),
    });
  } catch {
    throw Error(signal?.aborted ? 'Model request cancelled' : 'Model request failed');
  }
  // Never forward provider error bodies, which can contain request data or credentials.
  if (!response.ok) throw Error('Model request failed');
  let data: unknown;
  try { data = await response.json(); } catch { throw Error('Model analysis unavailable'); }
  return {answer: completedAnswer(data, config.provider), model: config.model, provider: config.provider};
}
