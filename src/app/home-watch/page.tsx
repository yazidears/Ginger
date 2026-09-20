import HomeWatch from '@/components/home-watch';
export const dynamic = 'force-dynamic';
export default function HomeWatchPage() {
  const configured = process.env.GINGER_IMESSAGE_CONTACT?.trim() ?? '';
  // A public sender number, never a recipient or a credential.
  const contact = /^\+[1-9]\d{7,14}$/.test(configured) ? configured : null;
  return <HomeWatch contact={contact}/>;
}
