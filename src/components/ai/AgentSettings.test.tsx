import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings } from "./AgentSettings";

const ipcMocks = vi.hoisted(() => ({
  agentMcpTest: vi.fn(),
  agentPluginList: vi.fn().mockResolvedValue([]),
  agentSettingsSave: vi.fn(),
  agentSkillList: vi.fn(),
}));

vi.mock("../../ipc", () => ipcMocks);

const settings = {
  profile: "desktop",
  bundles: ["core.desktop", "ssh.operations"],
  enabled_plugins: [],
  permission_mode: "confirm" as const,
  max_steps: 8,
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
        name: "mcp__filesystem__list",
        description: "List files",
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
  });
});
