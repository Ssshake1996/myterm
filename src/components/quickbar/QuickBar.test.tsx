import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "../../store/layout";
import { QuickBar } from "./QuickBar";

const ipcMocks = vi.hoisted(() => ({
  quickCommandList: vi.fn(),
  quickCommandSave: vi.fn(),
  quickCommandDelete: vi.fn(),
  quickCommandImportPreview: vi.fn(),
  quickCommandImportApply: vi.fn(),
  quickCommandExport: vi.fn(),
  terminalWrite: vi.fn(),
}));

vi.mock("../../ipc", () => ({
  ...ipcMocks,
}));

const commands = [
  { id: "a", label: "磁盘", group: "常用", command: "df -h", send_newline: true, sort: 0 },
  {
    id: "b",
    label: "重启",
    group: "常用",
    command: "systemctl restart app",
    send_newline: false,
    sort: 1,
  },
];

describe("QuickBar", () => {
  beforeEach(() => {
    ipcMocks.quickCommandList.mockResolvedValue(commands);
    ipcMocks.quickCommandSave.mockResolvedValue(undefined);
    ipcMocks.quickCommandDelete.mockResolvedValue(undefined);
    ipcMocks.quickCommandImportPreview.mockResolvedValue({
      source_format: "xshell_qbl",
      source_version: "8.2",
      total: 5,
      importable: 3,
      duplicates: 1,
      conflicts: 1,
      skipped: 1,
      groups: ["生产排查"],
    });
    ipcMocks.quickCommandImportApply.mockResolvedValue({
      imported: 3,
      replaced: 0,
      renamed: 1,
      duplicates: 1,
      skipped: 1,
    });
    ipcMocks.quickCommandExport.mockResolvedValue('{"format":"myterm.quick-commands"}');
    ipcMocks.terminalWrite.mockImplementation(async (sessionId: string) => {
      window.dispatchEvent(
        new CustomEvent("myterm:terminal-output", {
          detail: { sessionId, dataUtf8: "\r\nhost# " },
        }),
      );
    });
    useLayoutStore.setState({
      activeTabId: "tab",
      tabs: [
        {
          id: "tab",
          title: "prod",
          activePaneId: "pane",
          splitRatio: 50,
          panes: [
            {
              id: "pane",
              profileId: "profile",
              title: "prod",
              sessionId: "session-active",
              state: "connected",
              error: null,
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes commands to the active pane and only appends return when configured", async () => {
    const user = userEvent.setup();
    render(<QuickBar />);
    await user.click(await screen.findByRole("button", { name: /^磁盘/ }));
    await user.click(screen.getByRole("button", { name: /^重启/ }));

    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(1, "session-active", "df -h\r");
    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(
      2,
      "session-active",
      "systemctl restart app",
    );
  });

  it("executes a multiline command with terminal returns and hides command bodies", async () => {
    ipcMocks.quickCommandList.mockResolvedValue([
      ...commands,
      {
        id: "multi",
        label: "部署核对",
        group: "常用",
        command: "cd /srv/app\npwd\nsystemctl status app",
        send_newline: true,
        sort: 2,
      },
    ]);
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "部署核对" }));

    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(1, "session-active", "cd /srv/app\r");
    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(2, "session-active", "pwd\r");
    expect(ipcMocks.terminalWrite).toHaveBeenNthCalledWith(
      3,
      "session-active",
      "systemctl status app\r",
    );
    expect(screen.queryByText("df -h")).not.toBeInTheDocument();
    expect(screen.queryByText("systemctl status app")).not.toBeInTheDocument();
  });

  it("prevents overlapping quick command dispatches", async () => {
    ipcMocks.terminalWrite.mockImplementationOnce(() => new Promise<void>(() => undefined));
    const user = userEvent.setup();
    render(<QuickBar />);

    const disk = await screen.findByRole("button", { name: /^磁盘/ });
    const restart = screen.getByRole("button", { name: /^重启/ });
    await user.click(disk);

    await waitFor(() => {
      expect(disk).toBeDisabled();
      expect(restart).toBeDisabled();
    });
    await user.click(restart);
    expect(ipcMocks.terminalWrite).toHaveBeenCalledTimes(1);
  });

  it("preserves multiline command whitespace when saving", async () => {
    const user = userEvent.setup();
    render(<QuickBar />);
    await user.click(await screen.findByRole("button", { name: "新建快捷命令" }));
    await user.type(screen.getByLabelText("显示名"), "多行脚本");
    fireEvent.change(screen.getByLabelText("命令"), {
      target: { value: "printf 'one'\n  printf 'two'\n" },
    });

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(ipcMocks.quickCommandSave).toHaveBeenCalledWith(
        expect.objectContaining({ command: "printf 'one'\n  printf 'two'\n" }),
      ),
    );
  });

  it("disables command buttons without an active session", async () => {
    useLayoutStore.setState({ tabs: [], activeTabId: null });
    render(<QuickBar />);
    const command = await screen.findByRole("button", { name: /^磁盘/ });
    await waitFor(() => expect(command).toBeDisabled());
  });

  it("keeps large command sets searchable inside a grouped scroll region", async () => {
    const largeSet = Array.from({ length: 32 }, (_, index) => ({
      id: `diagnostic-${index}`,
      label: index === 17 ? "Nginx 错误日志" : `排查命令 ${index + 1}`,
      group: "排查",
      command:
        index === 17 ? "tail -n 200 /var/log/nginx/error.log" : `diagnose --check ${index + 1}`,
      send_newline: true,
      sort: index,
    }));
    ipcMocks.quickCommandList.mockResolvedValue([...commands, ...largeSet]);
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "排查 32" }));
    const library = screen.getByLabelText("排查命令");
    expect(within(library).getByText("32 条")).toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(32);

    await user.type(screen.getByRole("searchbox", { name: "搜索当前命令集" }), "nginx");
    expect(within(library).getByText("1 / 32 条")).toBeInTheDocument();
    expect(within(library).getAllByRole("listitem")).toHaveLength(1);
    expect(within(library).getByText("Nginx 错误日志")).toBeInTheDocument();
  });

  it("uses an explicit labeled control for collapsed and expanded states", async () => {
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "收起" }));
    const expand = screen.getByRole("button", { name: "展开" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "命令集" })).not.toBeInTheDocument();

    await user.click(expand);
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "命令集" })).toBeInTheDocument();
  });

  it("supports keyboard height adjustment on the desktop dock", async () => {
    render(<QuickBar />);
    const resizer = await screen.findByRole("separator", {
      name: "调整快捷命令面板高度",
    });
    expect(resizer).toHaveAttribute("aria-valuenow", "224");

    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    await waitFor(() => expect(resizer).toHaveAttribute("aria-valuenow", "236"));
  });

  it("previews Xshell imports and defaults conflicts to keeping both", async () => {
    const user = userEvent.setup();
    const { container } = render(<QuickBar />);
    await screen.findByRole("button", { name: "导入快捷命令" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error("快捷命令文件输入未渲染");
    const file = {
      name: "生产排查.qbl",
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([0xff, 0xfe, 1, 0]).buffer),
    };

    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole("dialog", { name: "导入快捷命令" });
    expect(within(dialog).getByText("Xshell QBL · v8.2")).toBeInTheDocument();
    expect(within(dialog).getByText("生产排查")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保留两者" })).toHaveClass("is-active");

    await user.click(within(dialog).getByRole("button", { name: "导入 3 条" }));
    await waitFor(() =>
      expect(ipcMocks.quickCommandImportApply).toHaveBeenCalledWith(
        "生产排查.qbl",
        [0xff, 0xfe, 1, 0],
        "keep_both",
      ),
    );
  });

  it("exports the selected scope as versioned JSON", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:quick-commands"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<QuickBar />);

    await user.click(await screen.findByRole("button", { name: "导出快捷命令" }));
    const dialog = screen.getByRole("dialog", { name: "导出快捷命令" });
    await user.click(within(dialog).getByRole("button", { name: "全部命令 · 2" }));
    await user.click(within(dialog).getByRole("button", { name: "导出 JSON" }));

    await waitFor(() => expect(ipcMocks.quickCommandExport).toHaveBeenCalledWith(undefined));
  });
});
