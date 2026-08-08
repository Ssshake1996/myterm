import { Fragment, type ReactNode } from "react";
import { terminalWrite } from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

function renderInline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const offset = match.index;
    if (offset > cursor) {
      result.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, offset)}</Fragment>);
    }
    const token = match[0];
    result.push(
      token.startsWith("**") ? (
        <strong key={`strong-${offset}`}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={`code-${offset}`}>{token.slice(1, -1)}</code>
      ),
    );
    cursor = offset + token.length;
  }
  if (cursor < text.length) {
    result.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>);
  }
  return result;
}

export function MarkdownContent({ content }: { content: string }) {
  const activePane = useLayoutStore(getActivePane);
  const notify = useUiStore((state) => state.notify);
  const blocks = content.split(/```([\w+-]*)\n([\s\S]*?)```/g);

  const fill = async (code: string) => {
    if (!activePane?.sessionId) return;
    try {
      await terminalWrite(activePane.sessionId, code.replace(/\n$/, ""));
      notify("命令已回填到终端", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "命令回填失败", "error");
    }
  };

  const nodes: ReactNode[] = [];
  for (let index = 0; index < blocks.length; index += 3) {
    const prose = blocks[index];
    if (prose) {
      const lines = prose.split("\n");
      for (const [lineIndex, line] of lines.entries()) {
        if (!line.trim()) continue;
        nodes.push(<p key={`p-${index}-${lineIndex}`}>{renderInline(line)}</p>);
      }
    }
    const language = blocks[index + 1];
    const code = blocks[index + 2];
    if (code !== undefined) {
      nodes.push(
        <div className="code-block" key={`code-${index}`}>
          <header>
            <span>{language || "shell"}</span>
            <div>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(code.replace(/\n$/, ""));
                  notify("已复制", "success");
                }}
                type="button"
              >
                <Icon name="copy" /> 复制
              </button>
              <button
                disabled={!activePane?.sessionId}
                onClick={() => void fill(code)}
                type="button"
              >
                <Icon name="terminal" /> 回填
              </button>
            </div>
          </header>
          <pre>
            <code>{code.replace(/\n$/, "")}</code>
          </pre>
        </div>,
      );
    }
  }
  return <div className="markdown-content">{nodes}</div>;
}
