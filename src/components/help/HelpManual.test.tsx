import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpManual } from "./HelpManual";

describe("HelpManual", () => {
  afterEach(cleanup);

  it("renders the packaged guide and closes from the dialog header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpManual onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "myterm 使用说明书" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "说明书目录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "服务器与会话" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "远端 CLI 与 REST 操作" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("0.6.3 已删除早期实现的本机 Agent CLI");

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
