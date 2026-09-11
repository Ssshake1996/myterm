import { Fragment, type ReactNode } from "react";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

export interface DocumentHeading {
  id: string;
  level: number;
  title: string;
}

function renderInline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const offset = match.index;
    if (offset > cursor)
      result.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, offset)}</Fragment>);
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
  if (cursor < text.length)
    result.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>);
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

function renderProse(
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
      nodes.push(
        heading[1].length === 1 ? (
          <h1 id={id} key={key}>
            {content}
          </h1>
        ) : heading[1].length === 2 ? (
          <h2 id={id} key={key}>
            {content}
          </h2>
        ) : (
          <h3 id={id} key={key}>
            {content}
          </h3>
        ),
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
    const paragraph = [line];
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

export function MarkdownDocument({ content }: { content: string }) {
  const notify = useUiStore((state) => state.notify);
  const blocks = content.split(/```([\w+-]*)\n([\s\S]*?)```/g);
  const nodes: ReactNode[] = [];
  const headingCounter = { value: 0 };
  for (let index = 0; index < blocks.length; index += 3) {
    if (blocks[index]) nodes.push(...renderProse(blocks[index], index, headingCounter));
    const language = blocks[index + 1];
    const code = blocks[index + 2];
    if (code === undefined) continue;
    const normalized = code.replace(/\n$/, "");
    nodes.push(
      <div className="code-block" key={`code-${index}`}>
        <header>
          <span>{language || "text"}</span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(normalized);
              notify("已复制", "success");
            }}
            type="button"
          >
            <Icon name="copy" /> 复制
          </button>
        </header>
        <pre>
          <code>{normalized}</code>
        </pre>
      </div>,
    );
  }
  return <div className="markdown-content markdown-content-document">{nodes}</div>;
}
