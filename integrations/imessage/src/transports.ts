import type {Adapter} from 'chat';

export type Transport = 'imessage' | 'telegram' | 'vonage';
type Channel = 'imessage' | 'telegram' | 'whatsapp';
const settings: Record<Transport, string[]> = {
  imessage: ['IMESSAGE_PROJECT_ID', 'IMESSAGE_PROJECT_SECRET', 'IMESSAGE_WEBHOOK_SECRET'],
  telegram: ['TELEGRAM_BOT_TOKEN'],
  vonage: ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_WHATSAPP_SENDER', 'VONAGE_WEBHOOK_TOKEN'],
};

export function transportPlan(env: Record<string, string | undefined>) {
  const primary = env.ASHCONNECT_TRANSPORT || 'imessage';
  if (primary !== 'imessage' && primary !== 'telegram' && primary !== 'vonage') throw new Error('ASHCONNECT_TRANSPORT must be imessage, vonage or telegram');
  const transports: Transport[] = [primary];
  // A second sender is never activated merely because credentials are present.
  if (env.ASHCONNECT_IMESSAGE_ENABLED === 'true' && primary !== 'imessage') transports.push('imessage');
  const missing = transports.flatMap(transport => settings[transport]).filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  return {primary, transports};
}

/** Route persisted conversation IDs only to the matching, configured adapter. Never fall back to the primary. */
export function createTransportRouter(adapters: Adapter[]) {
  const byChannel = new Map<string, Adapter>();
  for (const adapter of adapters) {
    if (!['imessage', 'telegram', 'whatsapp'].includes(adapter.name)) throw new Error('Unsupported messaging channel');
    if (byChannel.has(adapter.name)) throw new Error(`Duplicate messaging channel: ${adapter.name}`);
    byChannel.set(adapter.name, adapter);
  }
  if (!byChannel.size) throw new Error('At least one messaging adapter is required');
  return {
    channels: [...byChannel.keys()],
    send: async (thread: string, text: string) => {
      const adapter = byChannel.get(thread.slice(0, thread.indexOf(':')));
      if (!adapter) throw new Error('This conversation has no enabled messaging channel');
      adapter.decodeThreadId(thread);
      await adapter.postMessage(thread, text);
    },
    webhookChannel: (method: string | undefined, path: string | undefined): string | null => {
      if (method !== 'POST') return null;
      if (path === '/api/agents/ginger-watch/channels/imessage/webhook' && byChannel.has('imessage')) return 'imessage';
      if ((path === '/api/agents/ginger-watch/channels/whatsapp/webhook' || path === '/api/agents/ginger-watch/channels/whatsapp/status') && byChannel.has('whatsapp')) return 'whatsapp';
      return null;
    },
  };
}

export function publicChannelInfo(adapters: Adapter[], contactFor: (adapter: Adapter) => string | null | undefined) {
  const channels = adapters.map(adapter => {
    if (!['imessage', 'telegram', 'whatsapp'].includes(adapter.name)) throw new Error('Unsupported messaging channel');
    const channel = adapter.name as Channel;
    const contact = contactFor(adapter)?.trim() ?? '';
    const pattern = channel === 'telegram' ? /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/ : channel === 'whatsapp' ? /^[1-9]\d{7,14}$/ : /^\+[1-9]\d{7,14}$/;
    return {channel, contact: pattern.test(contact) ? contact : null};
  });
  if (!channels.length) throw new Error('At least one messaging adapter is required');
  return {...channels[0], channels: channels.filter((entry): entry is {channel: Channel; contact: string} => entry.contact !== null)};
}
