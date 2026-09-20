import type { Metadata } from 'next';
import './globals.css';
import WorkspaceShell from '@/components/workspace-shell';
export const metadata: Metadata = { title: 'GINGER · Prevent · Sage · Ash', description: 'Wildfire intelligence: Prevent assesses pre-fire conditions, Sage models propagation and consequences, and Ash supports the operational team.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><WorkspaceShell>{children}</WorkspaceShell></body></html>; }
