import { describe, expect, it } from "vitest";
import type { SessionProfile } from "../ipc";
import { getActivePane, useLayoutStore } from "./layout";

const profile: SessionProfile = {
  id: "profile-a",
  name: "prod-db",
  group: "prod/db",
  target: {
    kind: "ssh",
    host: "10.0.0.8",
    port: 22,
    username: "root",
    auth: { kind: "password", vault_ref: "profile.a.password" },
  },
};

describe("layout store", () => {
  it("keeps split panes on independent session ids", () => {
    useLayoutStore.setState({ tabs: [], activeTabId: null });
    useLayoutStore.getState().openProfile(profile);
    const firstPane = getActivePane(useLayoutStore.getState());
    expect(firstPane).not.toBeNull();
    useLayoutStore.getState().bindSession(firstPane?.id ?? "", {
      session_id: "session-left",
      profile_id: profile.id,
      state: "connected",
      error: null,
    });

    useLayoutStore.getState().splitActive();
    const tab = useLayoutStore.getState().tabs[0];
    expect(tab?.panes).toHaveLength(2);
    const rightPane = tab?.panes[1];
    useLayoutStore.getState().bindSession(rightPane?.id ?? "", {
      session_id: "session-right",
      profile_id: profile.id,
      state: "connected",
      error: null,
    });

    const sessions = useLayoutStore.getState().tabs[0]?.panes.map((pane) => pane.sessionId);
    expect(sessions).toEqual(["session-left", "session-right"]);
    expect(
      useLayoutStore.getState().tabs[0]?.panes.every((pane) => pane.state === "connected"),
    ).toBe(true);
  });

  it("marks a pane failed when connecting ends before a session id is assigned", () => {
    useLayoutStore.setState({ tabs: [], activeTabId: null });
    useLayoutStore.getState().openProfile(profile);
    const pane = getActivePane(useLayoutStore.getState());

    useLayoutStore.getState().failConnection(pane?.id ?? "", "authentication failed");

    expect(getActivePane(useLayoutStore.getState())).toMatchObject({
      sessionId: null,
      state: "failed",
      error: "authentication failed",
    });
  });

  it("closes either split pane and keeps the other pane active", () => {
    useLayoutStore.setState({ tabs: [], activeTabId: null });
    useLayoutStore.getState().openProfile(profile);
    useLayoutStore.getState().splitActive();
    const tab = useLayoutStore.getState().tabs[0];
    const leftPane = tab?.panes[0];
    const rightPane = tab?.panes[1];
    expect(tab?.activePaneId).toBe(rightPane?.id);

    useLayoutStore.getState().closePane(tab?.id ?? "", rightPane?.id ?? "");

    expect(useLayoutStore.getState().tabs[0]).toMatchObject({
      panes: [{ id: leftPane?.id }],
      activePaneId: leftPane?.id,
      splitRatio: 50,
    });
  });
});
