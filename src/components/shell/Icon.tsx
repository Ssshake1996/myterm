import type { ReactNode } from "react";

export type IconName =
  | "terminal"
  | "files"
  | "spark"
  | "settings"
  | "plus"
  | "search"
  | "close"
  | "split"
  | "chevron"
  | "copy"
  | "send"
  | "stop"
  | "folder"
  | "file"
  | "upload"
  | "download"
  | "edit"
  | "trash"
  | "refresh"
  | "check";

const icons: Record<IconName, ReactNode> = {
  terminal: "›_",
  files: "▤",
  spark: "✦",
  settings: "⚙",
  plus: "+",
  search: "⌕",
  close: "×",
  split: "◫",
  chevron: "⌄",
  copy: "▣",
  send: "↑",
  stop: "■",
  folder: "▸",
  file: "·",
  upload: "→",
  download: "←",
  edit: "✎",
  trash: "⌫",
  refresh: "↻",
  check: "✓",
};

export function Icon({ name }: { name: IconName }) {
  return <span className={`icon icon-${name}`}>{icons[name]}</span>;
}
