import { Fragment, type ReactNode } from "react";
import { terminalWrite } from "../../ipc";
import { getActivePane, useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

export interface DocumentHeading {
  id: string;
  level: number;
  title: string;
}

interface MarkdownContentProps {
  content: string;
  variant?: "message" | "document";
}

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

export function getDocumentHeadings(content: string): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  let headingIndex = 0;
  let inCode = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!match) continue;
    headingIndex += 1;
    headings.push({
      id: `help-heading-${headingIndex}`,
      level: match[1].length,
      title: match[2].trim(),
    });
  }
  return headings;
}

function renderDocumentProse(
  prose: string,
  blockIndex: number,
  headingCounter: { value: number },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = prose.split("\n");
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex].trim();
    if (!line) {
      lineIndex += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      headingCounter.value += 1;
      const id = `help-heading-${headingCounter.value}`;
      const content = renderInline(heading[2].trim());
      const key = `heading-${blockIndex}-${lineIndex}`;
      if (heading[1].length === 1)
        nodes.push(
          <h1 id={id} key={key}>
            {content}
          </h1>,
        );
      else if (heading[1].length === 2)
        nodes.push(
          <h2 id={id} key={key}>
            {content}
          </h2>,
        );
      else
        nodes.push(
          <h3 id={id} key={key}>
            {content}
          </h3>,
        );
      lineIndex += 1;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const items: ReactNode[] = [];
      const pattern = unordered ? /^[-*]\s+(.+)$/ : /^\d+\.\s+(.+)$/;
      while (lineIndex < lines.length) {
        const item = pattern.exec(lines[lineIndex].trim());
        if (!item) break;
        items.push(<li key={`item-${blockIndex}-${lineIndex}`}>{renderInline(item[1])}</li>);
        lineIndex += 1;
      }
      nodes.push(
        unordered ? (
          <ul key={`list-${blockIndex}-${lineIndex}`}>{items}</ul>
        ) : (
          <ol key={`list-${blockIndex}-${lineIndex}`}>{items}</ol>
        ),
      );
      continue;
    }

    const paragraph: string[] = [line];
    lineIndex += 1;
    while (lineIndex < lines.length) {
      const next = lines[lineIndex].trim();
      if (!next || /^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+/.test(next)) break;
      paragraph.push(next);
      lineIndex += 1;
    }
    nodes.push(
      <p key={`paragraph-${blockIndex}-${lineIndex}`}>{renderInline(paragraph.join(" "))}</p>,
    );
  }

  return nodes;
}

export function MarkdownContent({ content, variant = "message" }: MarkdownContentProps) {
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
  const headingCounter = { value: 0 };
  for (let index = 0; index < blocks.length; index += 3) {
    const prose = blocks[index];
    if (prose) {
      if (variant === "document") {
        nodes.push(...renderDocumentProse(prose, index, headingCounter));
      } else {
        for (const [lineIndex, line] of prose.split("\n").entries()) {
          if (!line.trim()) continue;
          nodes.push(<p key={`p-${index}-${lineIndex}`}>{renderInline(line)}</p>);
        }
      }
    }
    const language = blocks[index + 1];
    const code = blocks[index + 2];
    if (code === undefined) continue;
    const normalizedCode = code.replace(/\n$/, "");
    nodes.push(
      <div className="code-block" key={`code-${index}`}>
        <header>
          <span>{language || "shell"}</span>
          <div>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(normalizedCode);
                notify("已复制", "success");
              }}
              type="button"
            >
              <Icon name="copy" /> 复制
            </button>
            {variant === "message" ? (
              <button
                disabled={!activePane?.sessionId}
                onClick={() => void fill(code)}
                type="button"
              >
                <Icon name="terminal" /> 回填
              </button>
            ) : null}
          </div>
        </header>
        <pre>
          <code>{normalizedCode}</code>
        </pre>
      </div>,
    );
  }
  return <div className={`markdown-content markdown-content-${variant}`}>{nodes}</div>;
}
