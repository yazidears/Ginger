import type { Metadata } from 'next';
import './globals.css';
import WorkspaceShell from '@/components/workspace-shell';
export const metadata: Metadata = { title: 'GINGER · Barcelona Fire Receptivity', description: 'Live fire-receptivity intelligence for Barcelona and surrounding vegetation. Environmental conditions if an ignition occurs; never ignition probability.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><WorkspaceShell>{children}</WorkspaceShell></body></html>; }
