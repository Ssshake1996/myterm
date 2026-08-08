import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { profileDelete, type SessionProfile } from "../../ipc";
import { SessionSidebar } from "./SessionSidebar";

vi.mock("../../ipc", () => ({
  localShellList: vi.fn().mockResolvedValue(["powershell.exe"]),
  profileDelete: vi.fn().mockResolvedValue(undefined),
  profileSave: vi.fn(async (profile: SessionProfile) => profile),
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

  it("connects once on click and confirms deletion", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onProfilesChange = vi.fn();
    render(
      <SessionSidebar
        editorOpen={false}
        onConnect={onConnect}
        onEditorOpenChange={vi.fn()}
        onProfilesChange={onProfilesChange}
        profiles={profiles}
      />,
    );

    await user.click(screen.getByRole("button", { name: "连接 db-primary" }));
    expect(onConnect).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "删除 db-primary" }));
    expect(profileDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除会话" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除会话" }));

    expect(profileDelete).toHaveBeenCalledWith("db");
    expect(onProfilesChange).toHaveBeenCalledWith([profiles[1]]);
  });
});
