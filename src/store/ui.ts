import { create } from "zustand";
import type { AppFontScale, AppTheme, TerminalPalette } from "../ipc";

interface Toast {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
}

interface UiState {
  toasts: Toast[];
  theme: AppTheme;
  fontScale: AppFontScale;
  terminalFontSize: number;
  terminalPalette: TerminalPalette;
  workspaceView: "terminal" | "files";
  setTheme: (theme: AppTheme) => void;
  setFontScale: (scale: AppFontScale) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalPalette: (palette: TerminalPalette) => void;
  setWorkspaceView: (view: "terminal" | "files") => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: string) => void;
}

export const fontScaleFactor: Record<AppFontScale, number> = {
  small: 0.9,
  standard: 1,
  large: 1.15,
  extra_large: 1.3,
  scale_150: 1.5,
  scale_175: 1.75,
  scale_200: 2,
};

export function effectiveTerminalFontSize(size: number, scale: AppFontScale): number {
  return size * fontScaleFactor[scale];
}

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  theme: "dark",
  fontScale: "standard",
  terminalFontSize: 13,
  terminalPalette: "graphite_gold",
  workspaceView: "terminal",
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setFontScale: (fontScale) => {
    document.documentElement.dataset.fontScale = fontScale;
    set({ fontScale });
  },
  setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
  setTerminalPalette: (terminalPalette) => set({ terminalPalette }),
  setWorkspaceView: (workspaceView) => set({ workspaceView }),
  notify: (message, tone = "info") => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }] }));
    window.setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
