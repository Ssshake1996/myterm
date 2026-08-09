import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  {
    name: "config.yml",
    path: "/root/config.yml",
    is_dir: false,
    size: 256,
    modified: 1_776_000_000,
    permissions: "rw-------",
  },
];

const localEntries = [
  {
    name: "archive",
    path: "C:\\Users\\tester\\archive",
    is_dir: true,
    size: 0,
    modified: 1_776_000_000,
  },
  {
    name: "deploy.ps1",
    path: "C:\\Users\\tester\\deploy.ps1",
    is_dir: false,
    size: 512,
    modified: 1_776_000_000,
  },
  {
    name: "notes.txt",
    path: "C:\\Users\\tester\\notes.txt",
    is_dir: false,
    size: 128,
    modified: 1_776_000_000,
  },
];

describe("SftpView", () => {
  beforeEach(() => {
    ipcMocks.localDefaultDirectory.mockResolvedValue("C:\\Users\\tester");
    ipcMocks.sftpDefaultDirectory.mockResolvedValue("/root");
    ipcMocks.localReadDir.mockResolvedValue(localEntries);
    ipcMocks.sftpReadDir.mockResolvedValue(remoteEntries);
    ipcMocks.sftpUpload.mockImplementation(async (_sessionId, localPath) =>
      Promise.resolve(`upload-${localPath}`),
    );
    ipcMocks.sftpDownload.mockImplementation(async (_sessionId, remotePath) =>
      Promise.resolve(`download-${remotePath}`),
    );
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

  it("selects a local range with Shift, toggles with Ctrl, and uploads the selection", async () => {
    render(<SftpView sessionId="session-1" />);
    const first = (await screen.findByText("archive")).closest("tr") as HTMLElement;
    const middle = screen.getByText("deploy.ps1").closest("tr") as HTMLElement;
    const last = screen.getByText("notes.txt").closest("tr") as HTMLElement;

    fireEvent.click(first);
    fireEvent.click(last, { shiftKey: true });

    expect(first).toHaveAttribute("aria-selected", "true");
    expect(middle).toHaveAttribute("aria-selected", "true");
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("已选 3 项")).toBeInTheDocument();

    fireEvent.click(middle, { ctrlKey: true });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(middle).toHaveAttribute("aria-selected", "false");
    expect(last).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "上传" }));

    await waitFor(() => expect(ipcMocks.sftpUpload).toHaveBeenCalledTimes(2));
    expect(ipcMocks.sftpUpload).toHaveBeenCalledWith(
      "session-1",
      "C:\\Users\\tester\\archive",
      "/root/archive",
    );
    expect(ipcMocks.sftpUpload).toHaveBeenCalledWith(
      "session-1",
      "C:\\Users\\tester\\notes.txt",
      "/root/notes.txt",
    );
    expect(ipcMocks.notify).toHaveBeenCalledWith("已加入 2 个上传任务", "success");
  });

  it("downloads and deletes a remote range while reporting a partial delete failure", async () => {
    ipcMocks.sftpDelete.mockImplementation(async (_sessionId, path) => {
      if (path === "/root/app.jar") throw { message: "permission denied" };
    });
    render(<SftpView sessionId="session-1" />);
    const first = (await screen.findByText("releases")).closest("tr") as HTMLElement;
    const last = screen.getByText("config.yml").closest("tr") as HTMLElement;

    fireEvent.click(first);
    fireEvent.click(last, { shiftKey: true });

    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名远程项目" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    await waitFor(() => expect(ipcMocks.sftpDownload).toHaveBeenCalledTimes(3));
    expect(ipcMocks.sftpDownload).toHaveBeenCalledWith(
      "session-1",
      "/root/config.yml",
      "C:\\Users\\tester\\config.yml",
    );
    expect(ipcMocks.notify).toHaveBeenCalledWith("已加入 3 个下载任务", "success");

    fireEvent.click(screen.getByRole("button", { name: "删除远程项目" }));
    expect(screen.getByRole("dialog", { name: "删除 3 个远程项目" })).toBeInTheDocument();
    expect(screen.getByText(/确认删除所选的 3 个远程项目/u)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(ipcMocks.sftpDelete).toHaveBeenCalledTimes(3));
    expect(ipcMocks.notify).toHaveBeenCalledWith(
      "2 项已删除，1 项失败：app.jar：permission denied",
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
