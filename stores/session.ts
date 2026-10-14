'use client';
import { create } from 'zustand';
import type { Recipe, ScanPage } from '@/lib/types';

interface SessionStore {
  epoch: number;
  pages: ScanPage[];
  selectedId: string | null;
  select: (id: string) => void;
  addPages: (pages: ScanPage[]) => void;
  updatePage: (id: string, patch: Partial<ScanPage>) => void;
  updateRecipe: (id: string, patch: Partial<Recipe>) => void;
  removePage: (id: string) => void;
  duplicatePage: (id: string) => void;
  reorderPages: (from: number, to: number) => void;
  clear: () => void;
}

// Memory only: no persist middleware, browser database, or saved scan drafts.
export const useSession = create<SessionStore>((set) => ({
  pages: [], selectedId: null, epoch: 0,
  select: (id) => set({ selectedId: id }),
  addPages: (pages) => set((s) => ({ pages: [...s.pages, ...pages], selectedId: pages.at(-1)?.id ?? s.selectedId })),
  updatePage: (id, patch) => set((s) => ({ pages: s.pages.map((p) => p.id === id ? { ...p, ...patch } : p) })),
  updateRecipe: (id, patch) => set((s) => ({ pages: s.pages.map((p) => p.id === id ? { ...p, recipe: { ...p.recipe, ...patch } } : p) })),
  removePage: (id) => set((s) => { const pages = s.pages.filter((p) => p.id !== id); return { pages, selectedId: s.selectedId === id ? pages[0]?.id ?? null : s.selectedId }; }),
  duplicatePage: (id) => set((s) => { const page = s.pages.find((p) => p.id === id); if (!page) return s; const copy = { ...page, id: crypto.randomUUID(), corners: page.corners.map((p) => ({ ...p })) as ScanPage['corners'], recipe: { ...page.recipe }, redactions: page.redactions.map((r) => ({ ...r })) }; const pages = [...s.pages]; pages.splice(s.pages.indexOf(page) + 1, 0, copy); return { pages, selectedId: copy.id }; }),
  reorderPages: (from, to) => set((s) => { if (from < 0 || to < 0 || from >= s.pages.length || to >= s.pages.length) return s; const pages = [...s.pages]; const [page] = pages.splice(from, 1); pages.splice(to, 0, page); return { pages }; }),
  clear: () => set((s) => ({ pages: [], selectedId: null, epoch: s.epoch + 1 })),
}));
