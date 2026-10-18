'use client';
import Link from 'next/link';
import { ScanLine, Scan, Home, SlidersHorizontal, ArrowUpRight, ShieldCheck, Settings2, FileOutput, Sun, Moon } from 'lucide-react';
import { useSettings } from '@/stores/settings';
import { useSession } from '@/stores/session';
import { useOffline } from './providers';
import type { ReactNode } from 'react';
type Active = 'home' | 'scan' | 'edit' | 'export' | 'settings';
const nav = [ { id: 'home', label: 'Workspace', href: '/', icon: Home }, { id: 'scan', label: 'New scan', href: '/scan/', icon: Scan }, { id: 'edit', label: 'Refine & arrange', href: '/edit/', icon: SlidersHorizontal }, { id: 'export', label: 'Export', href: '/export/', icon: FileOutput } ] as const;
export function SecureBadge() { const { ready } = useOffline(); return <span className="secure-badge"><span className={ready ? 'status-dot' : 'status-dot pending'} />{ready ? 'Offline-ready' : 'Preparing offline'}<span className="badge-divider" />On-device only</span>; }
export function AppShell({ children, active, title, eyebrow }: { children: ReactNode; active: Active; title?: string; eyebrow?: string }) {
  const { theme, setTheme } = useSettings();
  const pageCount = useSession((s) => s.pages.length);
  return <div className="app-shell">
    <aside className="sidebar">
      <Link prefetch={false} className="brand" href="/" aria-label="Vaultscan home"><span className="brand-mark"><ScanLine size={23} strokeWidth={1.8} /></span><span>vaultscan<span className="brand-dot">.</span></span></Link>
      <div className="sidebar-label">YOUR SCANNER</div>
      <nav aria-label="Main navigation" className="side-nav">{nav.map(({ id, label, href, icon: Icon }) => <Link key={id} href={href} prefetch={false} className={`nav-link ${active === id ? 'is-active' : ''}`} aria-current={active === id ? 'page' : undefined}><Icon size={18} strokeWidth={1.6} /><span>{label}</span>{id === 'edit' && pageCount > 0 && <span className="nav-count">{pageCount}</span>}{id === 'scan' && <span className="nav-plus">+</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={21} /><strong>Privacy is built in.</strong><p>No accounts. No uploads.<br />Just you and your documents.</p><Link prefetch={false} href="/settings/">Privacy & settings <ArrowUpRight size={13} /></Link></div><div className="sidebar-settings-row"><Link prefetch={false} className={`nav-link ${active === 'settings' ? 'is-active' : ''}`} href="/settings/" aria-current={active === 'settings' ? 'page' : undefined}><Settings2 size={18} />Settings</Link><button className="theme-icon" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}</button></div><div className="sidebar-version"><span>VAULTSCAN</span><span>V1.0</span></div></div>
    </aside>
    <div className="main-area"><header className="topbar"><div className="mobile-brand"><ScanLine size={20} /><span>vaultscan.</span></div><div className="breadcrumb"><span>Workspace</span>{active !== 'home' && <><span className="breadcrumb-slash">/</span><span>{title || active}</span></>}</div><SecureBadge /></header><main className={`page-content page-${active}`} id="main-content">{title && <div className="page-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>}{children}</main><footer className="app-footer"><span><ShieldCheck size={13} />Nothing leaves this device until you share.</span><span>Designed to stay private.</span></footer></div>
  </div>;
}
