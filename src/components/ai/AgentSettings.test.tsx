import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings } from "./AgentSettings";

const ipcMocks = vi.hoisted(() => ({
  agentMcpTest: vi.fn(),
  agentSettingsSave: vi.fn(),
  agentSkillList: vi.fn(),
  errorMessage: (error: unknown, fallback: string) => {
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return fallback;
  },
}));

vi.mock("../../ipc", () => ipcMocks);

const settings = {
  permission_mode: "confirm" as const,
  skill_directories: [],
  enabled_skills: [],
  mcp_servers: [],
};

describe("AgentSettings", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("discovers a local SKILL.md and saves the enabled skill", async () => {
    ipcMocks.agentSkillList.mockResolvedValue([
      {
        id: "F:\\skills\\ops\\SKILL.md",
        name: "ops",
        description: "运维排查流程",
        path: "F:\\skills\\ops\\SKILL.md",
      },
    ]);
    ipcMocks.agentSettingsSave.mockImplementation(async (value) => value);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AgentSettings onClose={vi.fn()} onSaved={onSaved} settings={settings} />);

    await user.click(screen.getByRole("button", { name: /Skills/u }));
    await user.type(screen.getByRole("textbox", { name: "Skill 目录" }), "F:\\skills");
    await user.click(screen.getByRole("button", { name: /重新扫描/u }));
    await user.click(await screen.findByRole("checkbox", { name: /ops/u }));
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(ipcMocks.agentSettingsSave).toHaveBeenCalledWith({
        ...settings,
        skill_directories: ["F:\\skills"],
        enabled_skills: ["F:\\skills\\ops\\SKILL.md"],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("tests an unsaved stdio MCP server draft", async () => {
    ipcMocks.agentMcpTest.mockResolvedValue([
      {
        serverId: "server",
        serverName: "filesystem",
        transport: "stdio",
        name: "mcp__filesystem__list",
        description: "List files",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);
    const user = userEvent.setup();
    render(<AgentSettings onClose={vi.fn()} onSaved={vi.fn()} settings={settings} />);

    await user.click(screen.getByRole("button", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: /添加服务器/u }));
    await user.type(screen.getByRole("textbox", { name: "MCP 名称" }), "filesystem");
    await user.type(screen.getByRole("textbox", { name: "MCP 启动命令" }), "npx");
    await user.type(screen.getByRole("textbox", { name: "MCP 参数" }), "-y");
    await user.click(screen.getByRole("button", { name: /测试连接/u }));

    await waitFor(() =>
      expect(ipcMocks.agentMcpTest).toHaveBeenCalledWith(
        expect.objectContaining({ name: "filesystem", command: "npx", args: ["-y"] }),
      ),
    );
    expect(await screen.findByText(/发现 1 个工具/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看详情" }));
    expect(screen.getByText("mcp__filesystem__list")).toBeInTheDocument();
    expect(screen.getByText("List files")).toBeInTheDocument();
    expect(screen.getByText(/required/u)).toBeInTheDocument();
  });

  it("tests an unsaved streamable-http MCP draft with headers", async () => {
    ipcMocks.agentMcpTest.mockResolvedValue([
      {
        serverId: "http-server",
        serverName: "ops-http",
        transport: "streamable_http",
        name: "mcp__ops_http__list_hosts",
        description: "List hosts",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    const user = userEvent.setup();
    render(<AgentSettings onClose={vi.fn()} onSaved={vi.fn()} settings={settings} />);

    await user.click(screen.getByRole("button", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: /添加服务器/u }));
    await user.type(screen.getByRole("textbox", { name: "MCP 名称" }), "ops-http");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "MCP 传输类型" }),
      "streamable_http",
    );
    await user.type(
      screen.getByRole("textbox", { name: "MCP HTTP URL" }),
      "https://mcp.example.test/mcp",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "MCP 请求头" }), {
      target: { value: "Authorization: Bearer test-token" },
    });
    await user.click(screen.getByRole("button", { name: /测试连接/u }));

    await waitFor(() =>
      expect(ipcMocks.agentMcpTest).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ops-http",
          transport: "streamable_http",
          url: "https://mcp.example.test/mcp",
          headers: [{ name: "Authorization", value: "Bearer test-token" }],
        }),
      ),
    );
    expect(await screen.findByText(/发现 1 个工具/u)).toBeInTheDocument();
  });

  it("shows the serialized MCP process error without replacing it", async () => {
    ipcMocks.agentMcpTest.mockRejectedValue({
      code: "agent",
      message: "process spawn error: program not found (os error 2)\nstderr:\nnode: bad option",
    });
    const user = userEvent.setup();
    render(<AgentSettings onClose={vi.fn()} onSaved={vi.fn()} settings={settings} />);

    await user.click(screen.getByRole("button", { name: "MCP" }));
    await user.click(screen.getByRole("button", { name: /添加服务器/u }));
    await user.type(screen.getByRole("textbox", { name: "MCP 名称" }), "broken-server");
    await user.type(screen.getByRole("textbox", { name: "MCP 启动命令" }), "missing-mcp");
    await user.click(screen.getByRole("button", { name: /测试连接/u }));

    const error = await screen.findByRole("alert");
    expect(error.querySelector("pre")?.textContent).toBe(
      "process spawn error: program not found (os error 2)\nstderr:\nnode: bad option",
    );
    expect(error).not.toHaveTextContent("未返回可读的错误信息");
  });
});
