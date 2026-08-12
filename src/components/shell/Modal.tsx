import type { PropsWithChildren, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface ModalProps extends PropsWithChildren {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "small" | "medium" | "large" | "document";
}

export function Modal({ title, onClose, footer, size = "medium", children }: ModalProps) {
  return createPortal(
    <div className="modal-mask">
      <button aria-label="关闭弹窗" className="modal-backdrop" onClick={onClose} type="button" />
      <section aria-label={title} aria-modal="true" className={`modal modal-${size}`} role="dialog">
        <header className="modal-header">
          <h2>{title}</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.getElementById("root") ?? document.body,
  );
}
