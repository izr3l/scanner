'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { toast, subscribeToToastLayer } from '@/lib/toast';
import { ShieldCheck, ScanLine, Share2, ArrowRight, X, Download } from 'lucide-react';
import { useSettings } from '@/stores/settings';
import { useSession } from '@/stores/session';
import { MobileDock } from './mobile-dock';
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const ToastLayer = dynamic(() => import('./toast-layer'), { ssr: false });
const OfflineContext = createContext({ ready: false, installAvailable: false, install: () => {} });
export const useOffline = () => useContext(OfflineContext);
export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = useSettings((s) => s.theme);
  const pageCount = useSession((s) => s.pages.length);
  const [ready, setReady] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [intro, setIntro] = useState(false);
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [showToasts, setShowToasts] = useState(false);
  const introDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => subscribeToToastLayer(() => setShowToasts(true)), []);
  useEffect(() => { const dialog = introDialog.current; if (intro && dialog && !dialog.open) dialog.showModal(); else if (!intro && dialog?.open) dialog.close(); }, [intro]);
  useEffect(() => { document.documentElement.dataset.theme = theme; const meta = document.querySelector('meta[name="theme-color"]'); meta?.setAttribute('content', theme === 'dark' ? '#0A0B0F' : '#F6F4EF'); }, [theme]);
  useEffect(() => { setIntro(true); const visibility = () => setHidden(document.hidden); document.addEventListener('visibilitychange', visibility); return () => document.removeEventListener('visibilitychange', visibility); }, []);
  useEffect(() => {
    let alive = true;
    const handleInstall = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', handleInstall);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').then(async (registration) => {
        await navigator.serviceWorker.ready;
        if (alive) setReady(Boolean(registration.active));
        const updateToast = () => { if (registration.waiting) toast('An app update is ready', { description: 'Export and clear your session before updating.', duration: Infinity, action: { label: 'Update', onClick: () => { if (useSession.getState().pages.length) { toast('Export and clear your scans first to keep your work.'); return; } navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); registration.waiting?.postMessage({ type: 'SKIP_WAITING' }); } } }); };
        updateToast();
        registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', updateToast));
      }).catch(() => { if (alive) setReady(false); });
    }
    return () => { alive = false; window.removeEventListener('beforeinstallprompt', handleInstall); };
  }, []);
  async function install() { if (!prompt) return; await prompt.prompt(); await prompt.userChoice; setPrompt(null); }
  const screens = [ { icon: ShieldCheck, title: 'Your scans stay yours.', description: 'The camera, enhancement and export all run on this device. No uploads, accounts or analytics.' }, { icon: ScanLine, title: 'A temporary workspace.', description: 'Scans live only in memory. Export what you need before closing or reloading the app. There is no library or saved history.' }, { icon: Share2, title: 'You choose what to share.', description: 'Exports strip location and camera metadata. This app cannot protect against a compromised device, screenshots, or a file you choose to share.' } ];
  const ScreenIcon = screens[step].icon;
  return <OfflineContext.Provider value={{ ready, installAvailable: Boolean(prompt) && pageCount > 0, install }}><a className="skip-link" href="#main-content">Skip to content</a>{children}<MobileDock />{showToasts && <ToastLayer theme={theme} />}{hidden && <div className="privacy-cover"><ShieldCheck size={40} /><span>Vaultscan</span></div>}
    <dialog ref={introDialog} className="intro-sheet" aria-label="Privacy introduction" onClose={() => setIntro(false)}><button className="intro-close" aria-label="Close introduction" onClick={() => setIntro(false)}><X size={20} /></button><div className="intro-icon"><ScreenIcon size={34} strokeWidth={1.4} /></div><p className="eyebrow">PRIVATE BY DESIGN</p><h2>{screens[step].title}</h2><p className="intro-description">{screens[step].description}</p><div className="intro-bottom"><div className="intro-dots" aria-label={`Step ${step + 1} of 3`}>{screens.map((s, i) => <span key={s.title} className={step === i ? 'active' : ''} />)}</div><button type="button" className="button button-primary" onClick={() => step < 2 ? setStep(step + 1) : setIntro(false)}>{step < 2 ? 'Continue' : 'Get started'}<ArrowRight size={16} /></button></div></dialog>
    {Boolean(prompt) && pageCount > 0 && !pathname.startsWith('/scan') && !pathname.startsWith('/edit') && <button className="install-pill" onClick={install}><Download size={16} />Install for offline scanning</button>}
  </OfflineContext.Provider>;
}
