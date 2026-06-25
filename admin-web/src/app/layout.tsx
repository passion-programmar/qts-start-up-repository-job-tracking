import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME } from '@/lib/branding';

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} web application`,
  icons: {
    icon: '/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
