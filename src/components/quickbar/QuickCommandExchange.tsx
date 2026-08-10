import { useState } from "react";
import {
  type QuickCommandImportPreview,
  type QuickCommandImportStrategy,
  quickCommandExport,
  quickCommandImportApply,
} from "../../ipc";
import { useUiStore } from "../../store/ui";
import { Modal } from "../shell/Modal";

export interface QuickCommandImportState {
  fileName: string;
  bytes: number[];
  preview: QuickCommandImportPreview;
}

export function QuickCommandImportModal({
  state,
  onClose,
  onImported,
}: {
  state: QuickCommandImportState;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const notify = useUiStore((store) => store.notify);
  const [strategy, setStrategy] = useState<QuickCommandImportStrategy>("keep_both");
  const [busy, setBusy] = useState(false);
  const source = state.preview.source_format === "xshell_qbl" ? "Xshell QBL" : "myterm JSON";

  const apply = async () => {
    setBusy(true);
    try {
      const result = await quickCommandImportApply(state.fileName, state.bytes, strategy);
      const parts = [`新增 ${result.imported} 条`];
      if (result.replaced) parts.push(`覆盖 ${result.replaced} 条`);
      if (result.renamed) parts.push(`重命名 ${result.renamed} 条`);
      if (result.duplicates) parts.push(`跳过重复 ${result.duplicates} 条`);
      onImported(`快捷命令导入完成：${parts.join("，")}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "快捷命令导入失败", "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <button className="button button-ghost" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button
            className="button button-primary"
            disabled={busy || state.preview.importable === 0}
            onClick={() => void apply()}
            type="button"
          >
            {busy ? "正在导入" : `导入 ${state.preview.importable} 条`}
          </button>
        </>
      }
      onClose={onClose}
      size="small"
      title="导入快捷命令"
    >
      <div className="quick-import-summary">
        <header>
          <strong>{state.fileName}</strong>
          <span>
            {source} · v{state.preview.source_version}
          </span>
        </header>
        <dl>
          <div>
            <dt>文件命令</dt>
            <dd>{state.preview.total}</dd>
          </div>
          <div>
            <dt>可导入</dt>
            <dd>{state.preview.importable}</dd>
          </div>
          <div>
            <dt>完全重复</dt>
            <dd>{state.preview.duplicates}</dd>
          </div>
          <div>
            <dt>同名冲突</dt>
            <dd>{state.preview.conflicts}</dd>
          </div>
          <div>
            <dt>不支持</dt>
            <dd>{state.preview.skipped}</dd>
          </div>
          <div>
            <dt>命令集</dt>
            <dd>{state.preview.groups.length}</dd>
          </div>
        </dl>
        <p className="quick-import-groups">
          {state.preview.groups.join(" · ") || "无可导入命令集"}
        </p>
      </div>
      {state.preview.conflicts > 0 ? (
        <fieldset className="quick-import-conflicts">
          <legend>同名冲突处理</legend>
          <div className="segmented">
            <button
              className={strategy === "keep_both" ? "is-active" : ""}
              onClick={() => setStrategy("keep_both")}
              type="button"
            >
              保留两者
            </button>
            <button
              className={strategy === "overwrite" ? "is-active" : ""}
              onClick={() => setStrategy("overwrite")}
              type="button"
            >
              覆盖同名
            </button>
          </div>
        </fieldset>
      ) : null}
    </Modal>
  );
}

export function QuickCommandExportModal({
  currentGroup,
  currentGroupCount,
  total,
  onClose,
  onExported,
}: {
  currentGroup: string;
  currentGroupCount: number;
  total: number;
  onClose: () => void;
  onExported: (message: string) => void;
}) {
  const notify = useUiStore((state) => state.notify);
  const [scope, setScope] = useState<"current" | "all">("current");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const selectedGroup = scope === "current" ? currentGroup : undefined;
      const source = await quickCommandExport(selectedGroup);
      const suffix = selectedGroup ? safeFilePart(selectedGroup) : "all";
      const fileName = `myterm-quick-commands-${suffix}-${dateStamp()}.json`;
      downloadTextFile(fileName, source);
      onExported(`已导出 ${scope === "current" ? currentGroupCount : total} 条快捷命令`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "快捷命令导出失败", "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <button className="button button-ghost" disabled={busy} onClick={onClose} type="button">
            取消
          </button>
          <button
            className="button button-primary"
            disabled={busy || total === 0 || (scope === "current" && currentGroupCount === 0)}
            onClick={() => void run()}
            type="button"
          >
            {busy ? "正在导出" : "导出 JSON"}
          </button>
        </>
      }
      onClose={onClose}
      size="small"
      title="导出快捷命令"
    >
      <div className="quick-export-scope">
        <fieldset className="segmented">
          <legend className="visually-hidden">导出范围</legend>
          <button
            className={scope === "current" ? "is-active" : ""}
            onClick={() => setScope("current")}
            type="button"
          >
            当前命令集 · {currentGroupCount}
          </button>
          <button
            className={scope === "all" ? "is-active" : ""}
            onClick={() => setScope("all")}
            type="button"
          >
            全部命令 · {total}
          </button>
        </fieldset>
        <strong>{scope === "current" ? currentGroup : "全部命令集"}</strong>
      </div>
    </Modal>
  );
}

function safeFilePart(value: string) {
  const printable = [...value].filter((character) => character.charCodeAt(0) >= 32).join("");
  return printable.replace(/[<>:"/\\|?*]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

function dateStamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function downloadTextFile(fileName: string, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
