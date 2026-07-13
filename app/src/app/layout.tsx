import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import AppShell from '@/components/layout/AppShell';
import RumProvider from '@/components/RumProvider';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'NFM Dashboard',
  description: 'VPC Network Flow Monitoring Dashboard',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Applies the persisted theme before hydration to avoid a flash of wrong theme.
const themeInitScript = `try{if(localStorage.getItem('nfm-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${inter.variable} antialiased`}>
      <body className="min-h-screen bg-white text-ink dark:bg-ink dark:text-white">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AppShell>{children}</AppShell>
        <RumProvider />
      </body>
    </html>
  );
}
