'use client';
import { create } from 'zustand';
import { DEFAULT_ARRANGEMENT, type ArrangeOptions } from '@/lib/types';
type Settings = {
  theme: 'dark' | 'light'; watermark: string; autoCapture: boolean;
  arrangement: ArrangeOptions;
  setArrangement: (patch: Partial<ArrangeOptions>) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setWatermark: (watermark: string) => void;
  setAutoCapture: (autoCapture: boolean) => void;
};
export const useSettings = create<Settings>((set) => ({
  theme: 'dark', watermark: '', autoCapture: true,
  arrangement: { ...DEFAULT_ARRANGEMENT },
  setArrangement: (patch) => set((s) => ({ arrangement: { ...s.arrangement, ...patch } })),
  setTheme: (theme) => set({ theme }),
  setWatermark: (watermark) => set({ watermark }),
  setAutoCapture: (autoCapture) => set({ autoCapture }),
}));
