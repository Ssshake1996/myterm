import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localShellList, profileSave, type SessionProfile } from "../../ipc";
import { ProfileModal } from "./ProfileModal";

vi.mock("../../ipc", () => ({
  localShellList: vi.fn().mockResolvedValue(["powershell.exe"]),
  profileSave: vi.fn(),
}));

const existing: SessionProfile = {
  id: "server-existing",
  name: "旧名称",
  group: "生产环境",
  target: {
    kind: "ssh",
    host: "192.168.3.94",
    port: 22,
    username: "root",
    auth: { kind: "password", vault_ref: "profile.server-existing.password" },
  },
};

describe("ProfileModal", () => {
  beforeEach(() => {
    vi.mocked(profileSave).mockImplementation(async (profile) => profile);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("saves a new password profile and connects", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onSaved={onSaved} profile={null} />);

    await user.type(screen.getByLabelText("名称"), "机房服务器");
    await user.type(screen.getByLabelText("主机"), "192.168.3.94");
    await user.type(screen.getByLabelText("密码"), "temporary-secret");
    await user.click(screen.getByRole("button", { name: "保存并连接" }));

    await waitFor(() => expect(profileSave).toHaveBeenCalledTimes(1));
    expect(profileSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "机房服务器",
        target: expect.objectContaining({
          kind: "ssh",
          host: "192.168.3.94",
          port: 22,
          username: "root",
        }),
      }),
      "temporary-secret",
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "机房服务器" }), true);
  });

  it("edits metadata while retaining the saved password", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<ProfileModal onClose={vi.fn()} onSaved={onSaved} profile={existing} />);

    const name = screen.getByLabelText("名称");
    await user.clear(name);
    await user.type(name, "新名称");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(profileSave).toHaveBeenCalledTimes(1));
    expect(profileSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "server-existing", name: "新名称" }),
      undefined,
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "新名称" }), false);
  });

  it("renders the edit form before local shell discovery completes", async () => {
    const user = userEvent.setup();
    let resolveShells: ((values: string[]) => void) | undefined;
    vi.mocked(localShellList).mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveShells = resolve;
        }),
    );

    render(<ProfileModal onClose={vi.fn()} onSaved={vi.fn()} profile={existing} />);

    expect(screen.getByLabelText("名称")).toHaveValue("旧名称");
    expect(screen.getByLabelText("名称")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("主机")).toHaveValue("192.168.3.94");
    expect(screen.getByLabelText("密码")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "本地终端" }));
    expect(screen.getByRole("combobox", { name: "Shell" })).toHaveAttribute("aria-busy", "true");

    resolveShells?.(["powershell.exe", "wsl.exe"]);
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Shell" })).toHaveAttribute("aria-busy", "false"),
    );
    expect(screen.getByRole("option", { name: "wsl.exe" })).toBeInTheDocument();
  });
});
