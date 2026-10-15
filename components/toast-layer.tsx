'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Toaster } from 'sonner';
import { markToastLayerReady } from '@/lib/toast';
export default function ToastLayer({ theme }: { theme: 'dark' | 'light' }) { const pathname = usePathname(); useEffect(() => { markToastLayerReady(); }, []); return <Toaster theme={theme} position={pathname.startsWith('/scan') ? 'top-center' : 'bottom-right'} closeButton toastOptions={{ className: 'vault-toast' }} />; }
