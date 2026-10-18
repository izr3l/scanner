'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, Scan, SlidersHorizontal, FileOutput, Settings2 } from 'lucide-react';

const destinations = [
  { id: 'home', href: '/', label: 'Home', name: 'Home workspace', Icon: Home },
  { id: 'scan', href: '/scan/', label: 'Scan', name: 'New scan', Icon: Scan },
  { id: 'edit', href: '/edit/', label: 'Edit', name: 'Edit, refine & arrange', Icon: SlidersHorizontal },
  { id: 'export', href: '/export/', label: 'Export', name: 'Export documents', Icon: FileOutput },
  { id: 'settings', href: '/settings/', label: 'Settings', name: 'Settings', Icon: Settings2 },
] as const;

export function MobileDock() {
  const pathname = usePathname();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const route = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const active = destinations.find(({ href }) => href === route)?.id;

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateKeyboard = () => {
      const field = document.activeElement;
      const editing = field instanceof HTMLTextAreaElement && !field.readOnly
        || field instanceof HTMLInputElement && !field.readOnly && ['text', 'search', 'url', 'email', 'tel', 'number', 'password'].includes(field.type)
        || field instanceof HTMLElement && field.isContentEditable;
      // Normalize zoom so pinch-only shrink does not look like a keyboard,
      // while still handling Safari's focused-input auto-zoom.
      setKeyboardOpen(editing && viewport.scale > 0 && window.innerHeight - viewport.height * viewport.scale > 120);
    };
    viewport.addEventListener('resize', updateKeyboard);
    document.addEventListener('focusin', updateKeyboard);
    document.addEventListener('focusout', updateKeyboard);
    updateKeyboard();
    return () => {
      viewport.removeEventListener('resize', updateKeyboard);
      document.removeEventListener('focusin', updateKeyboard);
      document.removeEventListener('focusout', updateKeyboard);
    };
  }, []);

  // Capture has its own full-screen controls. This component stays mounted in
  // Providers so the selection can travel between the other page destinations.
  if (!active || active === 'scan') return null;

  return <div className="mobile-dock-positioner" data-keyboard-open={keyboardOpen}>
    <nav className="mobile-nav" aria-label="Mobile navigation" data-active={active}>
      <span className="mobile-dock-selection" aria-hidden="true" />
      {destinations.map(({ id, href, label, name, Icon }) => <Link className="mobile-dock-link" key={id} href={href} prefetch={false} aria-label={name} aria-current={active === id ? 'page' : undefined}>
        <span className="mobile-dock-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.75} /></span>
        <span className="mobile-dock-label">{label}</span>
      </Link>)}
    </nav>
  </div>;
}
