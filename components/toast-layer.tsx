'use client';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { markToastLayerReady } from '@/lib/toast';
export default function ToastLayer({ theme }: { theme: 'dark' | 'light' }) { useEffect(() => { markToastLayerReady(); }, []); return <Toaster theme={theme} position="bottom-right" closeButton toastOptions={{ className: 'vault-toast' }} />; }
