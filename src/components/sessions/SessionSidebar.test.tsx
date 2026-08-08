import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionProfile } from "../../ipc";
import { SessionSidebar } from "./SessionSidebar";

vi.mock("../../ipc", () => ({
  localShellList: vi.fn().mockResolvedValue(["powershell.exe"]),
  profileDelete: vi.fn().mockResolvedValue(undefined),
  profileSave: vi.fn().mockResolvedValue(undefined),
  vaultSet: vi.fn().mockResolvedValue(undefined),
}));

const profiles: SessionProfile[] = [
  {
    id: "db",
    name: "db-primary",
    group: "prod/db",
    target: {
      kind: "ssh",
      host: "10.0.0.8",
      port: 22,
      username: "dba",
      auth: { kind: "password", vault_ref: "db.password" },
    },
  },
  {
    id: "web",
    name: "web-primary",
    group: "prod/web",
    target: {
      kind: "ssh",
      host: "10.0.0.9",
      port: 22,
      username: "root",
      auth: { kind: "password", vault_ref: "web.password" },
    },
  },
];

describe("SessionSidebar", () => {
  afterEach(cleanup);

  it("renders nested groups and filters by profile name", async () => {
    const user = userEvent.setup();
    render(
      <SessionSidebar
        editorOpen={false}
        onConnect={vi.fn()}
        onEditorOpenChange={vi.fn()}
        onProfilesChange={vi.fn()}
        profiles={profiles}
      />,
    );

    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("db")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "搜索会话" }), "db");
    expect(screen.getByText("db-primary")).toBeInTheDocument();
    expect(screen.queryByText("web-primary")).not.toBeInTheDocument();
  });
});
