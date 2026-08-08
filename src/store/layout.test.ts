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
    useLayoutStore.getState().bindSession(firstPane?.id ?? "", "session-left");

    useLayoutStore.getState().splitActive();
    const tab = useLayoutStore.getState().tabs[0];
    expect(tab?.panes).toHaveLength(2);
    const rightPane = tab?.panes[1];
    useLayoutStore.getState().bindSession(rightPane?.id ?? "", "session-right");

    const sessions = useLayoutStore.getState().tabs[0]?.panes.map((pane) => pane.sessionId);
    expect(sessions).toEqual(["session-left", "session-right"]);
  });
});
