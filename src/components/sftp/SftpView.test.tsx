import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpView } from "./SftpView";

const ipcMocks = vi.hoisted(() => ({
  localReadDir: vi.fn(),
  sftpReadDir: vi.fn(),
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRename: vi.fn(),
  sftpDelete: vi.fn(),
  transferCancel: vi.fn(),
  onTransferProgress: vi.fn(),
}));

vi.mock("../../ipc", () => ({ ...ipcMocks }));

const remoteEntries = [
  {
    name: "releases",
    path: "/opt/app/releases",
    is_dir: true,
    size: 0,
    modified: 1_776_000_000,
    permissions: "rwxr-xr-x",
  },
  {
    name: "app.jar",
    path: "/opt/app/app.jar",
    is_dir: false,
    size: 1024,
    modified: 1_776_000_000,
    permissions: "rw-r--r--",
  },
];

describe("SftpView", () => {
  beforeEach(() => {
    ipcMocks.localReadDir.mockResolvedValue([]);
    ipcMocks.sftpReadDir.mockResolvedValue(remoteEntries);
    ipcMocks.sftpMkdir.mockResolvedValue(undefined);
    ipcMocks.sftpRename.mockResolvedValue(undefined);
    ipcMocks.sftpDelete.mockResolvedValue(undefined);
    ipcMocks.onTransferProgress.mockResolvedValue(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("creates, renames, and recursively deletes remote entries", async () => {
    const user = userEvent.setup();
    render(<SftpView sessionId="session-1" />);
    await screen.findByText("releases");

    await user.click(screen.getByRole("button", { name: "新建远程目录" }));
    await user.type(screen.getByRole("textbox", { name: "目录名" }), "archive");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(ipcMocks.sftpMkdir).toHaveBeenCalledWith("session-1", "/opt/app/archive"),
    );

    await user.click(screen.getByText("app.jar").closest("tr") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "重命名远程项目" }));
    const rename = screen.getByRole("textbox", { name: "新名称" });
    await user.clear(rename);
    await user.type(rename, "service.jar");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(ipcMocks.sftpRename).toHaveBeenCalledWith(
        "session-1",
        "/opt/app/app.jar",
        "/opt/app/service.jar",
      ),
    );

    await user.click(screen.getByText("releases").closest("tr") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "删除远程项目" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(ipcMocks.sftpDelete).toHaveBeenCalledWith("session-1", "/opt/app/releases", true),
    );
    expect(ipcMocks.sftpReadDir).toHaveBeenCalledTimes(4);
  });
});
