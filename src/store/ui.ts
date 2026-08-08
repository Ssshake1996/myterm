import { create } from "zustand";

interface Toast {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
}

interface UiState {
  toasts: Toast[];
  workspaceView: "terminal" | "files";
  setWorkspaceView: (view: "terminal" | "files") => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: string) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  workspaceView: "terminal",
  setWorkspaceView: (workspaceView) => set({ workspaceView }),
  notify: (message, tone = "info") => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, tone, message }] }));
    window.setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
