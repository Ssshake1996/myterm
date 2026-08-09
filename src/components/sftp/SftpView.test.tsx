import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpView } from "./SftpView";

const ipcMocks = vi.hoisted(() => ({
  localReadDir: vi.fn(),
  localDefaultDirectory: vi.fn(),
  sftpReadDir: vi.fn(),
  sftpDefaultDirectory: vi.fn(),
  sftpUpload: vi.fn(),
  sftpDownload: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRename: vi.fn(),
  sftpDelete: vi.fn(),
  transferCancel: vi.fn(),
  onTransferProgress: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../ipc", () => ({ ...ipcMocks }));
vi.mock("../../store/ui", () => ({
  useUiStore: (selector: (state: { notify: typeof ipcMocks.notify }) => unknown) =>
    selector({ notify: ipcMocks.notify }),
}));

const remoteEntries = [
  {
    name: "releases",
    path: "/root/releases",
    is_dir: true,
    size: 0,
    modified: 1_776_000_000,
    permissions: "rwxr-xr-x",
  },
  {
    name: "app.jar",
    path: "/root/app.jar",
    is_dir: false,
    size: 1024,
    modified: 1_776_000_000,
    permissions: "rw-r--r--",
  },
];

describe("SftpView", () => {
  beforeEach(() => {
    ipcMocks.localDefaultDirectory.mockResolvedValue("C:\\Users\\tester");
    ipcMocks.sftpDefaultDirectory.mockResolvedValue("/root");
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
      expect(ipcMocks.sftpMkdir).toHaveBeenCalledWith("session-1", "/root/archive"),
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
        "/root/app.jar",
        "/root/service.jar",
      ),
    );

    await user.click(screen.getByText("releases").closest("tr") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "删除远程项目" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(ipcMocks.sftpDelete).toHaveBeenCalledWith("session-1", "/root/releases", true),
    );
    expect(ipcMocks.sftpReadDir).toHaveBeenCalledTimes(4);
  });

  it("keeps remote entries visible when the local directory cannot be read", async () => {
    ipcMocks.localReadDir.mockRejectedValue({
      code: "io",
      message: "I/O error: directory does not exist",
    });

    render(<SftpView sessionId="session-1" />);

    expect(await screen.findByText("releases")).toBeInTheDocument();
    expect(ipcMocks.sftpReadDir).toHaveBeenCalledWith("session-1", "/root");
    expect(ipcMocks.notify).toHaveBeenCalledWith(
      "本地目录读取失败：I/O error: directory does not exist",
      "error",
    );
  });

  it("refreshes the current remote directory without changing its path", async () => {
    const user = userEvent.setup();
    render(<SftpView sessionId="session-1" />);
    await screen.findByText("releases");

    await user.click(screen.getByRole("button", { name: "刷新远程目录" }));

    await waitFor(() => expect(ipcMocks.sftpReadDir).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("textbox", { name: "远程路径" })).toHaveValue("/root");
  });

  it("resolves a fresh remote directory before reading after a session switch", async () => {
    ipcMocks.sftpDefaultDirectory.mockImplementation(async (sessionId: string) =>
      sessionId === "session-1" ? "/root" : "/srv",
    );
    const { rerender } = render(<SftpView sessionId="session-1" />);
    await screen.findByText("releases");

    rerender(<SftpView sessionId="session-2" />);

    await waitFor(() => expect(ipcMocks.sftpReadDir).toHaveBeenCalledWith("session-2", "/srv"));
    expect(ipcMocks.sftpReadDir).not.toHaveBeenCalledWith("session-2", "/root");
  });
});
