import userGuide from "../../../docs/user-guide.zh-CN.md?raw";
import { getDocumentHeadings, MarkdownContent } from "../ai/MarkdownContent";
import { Modal } from "../shell/Modal";

interface HelpManualProps {
  onClose: () => void;
}

const sections = getDocumentHeadings(userGuide).filter((heading) => heading.level === 2);

export function HelpManual({ onClose }: HelpManualProps) {
  return (
    <Modal onClose={onClose} size="document" title="myterm 使用说明书">
      <div className="help-manual">
        <nav aria-label="说明书目录" className="help-manual-nav">
          <strong>目录</strong>
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() =>
                document.getElementById(section.id)?.scrollIntoView({ block: "start" })
              }
              type="button"
            >
              {section.title}
            </button>
          ))}
        </nav>
        <article className="help-manual-content">
          <MarkdownContent content={userGuide} variant="document" />
        </article>
      </div>
    </Modal>
  );
}
