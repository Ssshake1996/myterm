import { create } from "zustand";
import type { SessionProfile, SessionState } from "../ipc";

export interface PaneModel {
  id: string;
  profileId: string;
  title: string;
  sessionId: string | null;
  state: SessionState;
  error: string | null;
}

export interface TabModel {
  id: string;
  title: string;
  panes: PaneModel[];
  activePaneId: string;
  splitRatio: number;
}

interface LayoutState {
  tabs: TabModel[];
  activeTabId: string | null;
  openProfile: (profile: SessionProfile) => string;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  reorderTab: (sourceId: string, targetId: string) => void;
  splitActive: () => void;
  selectPane: (tabId: string, paneId: string) => void;
  bindSession: (paneId: string, sessionId: string) => void;
  updateSession: (sessionId: string, state: SessionState, error: string | null) => void;
  setSplitRatio: (tabId: string, ratio: number) => void;
}

function makePane(profile: SessionProfile): PaneModel {
  return {
    id: crypto.randomUUID(),
    profileId: profile.id,
    title: profile.name,
    sessionId: null,
    state: "connecting",
    error: null,
  };
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  openProfile: (profile) => {
    const existing = get().tabs.find(
      (tab) => tab.panes.length === 1 && tab.panes[0]?.profileId === profile.id,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }
    const pane = makePane(profile);
    const tab: TabModel = {
      id: crypto.randomUUID(),
      title: profile.name,
      panes: [pane],
      activePaneId: pane.id,
      splitRatio: 50,
    };
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },
  closeTab: (tabId) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId);
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const fallback = tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null;
      return {
        tabs,
        activeTabId: state.activeTabId === tabId ? fallback : state.activeTabId,
      };
    }),
  selectTab: (activeTabId) => set({ activeTabId }),
  reorderTab: (sourceId, targetId) =>
    set((state) => {
      const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceId);
      const targetIndex = state.tabs.findIndex((tab) => tab.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return state;
      const tabs = [...state.tabs];
      const [source] = tabs.splice(sourceIndex, 1);
      if (!source) return state;
      tabs.splice(targetIndex, 0, source);
      return { tabs };
    }),
  splitActive: () =>
    set((state) => {
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== state.activeTabId || tab.panes.length >= 2) return tab;
        const source = tab.panes.find((pane) => pane.id === tab.activePaneId) ?? tab.panes[0];
        if (!source) return tab;
        const pane: PaneModel = {
          ...source,
          id: crypto.randomUUID(),
          sessionId: null,
          state: "connecting",
          error: null,
        };
        return { ...tab, panes: [...tab.panes, pane], activePaneId: pane.id };
      });
      return { tabs };
    }),
  selectPane: (tabId, paneId) =>
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, activePaneId: paneId } : tab)),
    })),
  bindSession: (paneId, sessionId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        panes: tab.panes.map((pane) =>
          pane.id === paneId ? { ...pane, sessionId, state: "connecting" } : pane,
        ),
      })),
    })),
  updateSession: (sessionId, sessionState, error) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        panes: tab.panes.map((pane) =>
          pane.sessionId === sessionId ? { ...pane, state: sessionState, error } : pane,
        ),
      })),
    })),
  setSplitRatio: (tabId, splitRatio) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, splitRatio } : tab)),
    })),
}));

export function getActivePane(state: LayoutState): PaneModel | null {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  return tab?.panes.find((pane) => pane.id === tab.activePaneId) ?? null;
}
