import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Providers } from '@/components/providers';
import './globals.css';
import './vendor.css';
import './mobile-dock.css';
const inter = localFont({ src: './fonts/inter.woff2', variable: '--font-inter', weight: '100 900', style: 'normal', display: 'swap' });
const syne = localFont({ src: './fonts/syne.woff2', variable: '--font-syne', weight: '400 800', style: 'normal', display: 'swap' });
const mono = localFont({ src: './fonts/mono.woff2', variable: '--font-mono', weight: '100 800', style: 'normal', display: 'swap', preload: false });
export const metadata: Metadata = { title: 'Vaultscan — Secure Document Scanner', description: 'Capture, refine and export documents. Privately, on your device.', manifest: '/manifest.webmanifest', icons: { icon: '/favicon.svg', apple: '/icon-192.png' }, appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Vaultscan' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0A0B0F' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" data-theme="dark"><body className={`${inter.variable} ${syne.variable} ${mono.variable}`}><Providers>{children}</Providers></body></html>; }
