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

    expect(screen.getByRole("dialog", { name: "myterm 使用说明书" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "说明书目录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "服务器与会话" })).toBeInTheDocument();
    expect(screen.getByText("myterm agent run", { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
