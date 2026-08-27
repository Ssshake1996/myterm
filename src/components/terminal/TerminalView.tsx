import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type AppTheme,
  createChannel,
  formatIpcError,
  publishTerminalOutput,
  type SessionProfile,
  sessionConnect,
  sessionDisconnect,
  type TerminalInputEventDetail,
  type TerminalPalette,
  type TerminalScreenSnapshot,
  terminalResize,
  terminalScreenUpdate,
  terminalWrite,
} from "../../ipc";
import type { PaneModel } from "../../store/layout";
import { useLayoutStore } from "../../store/layout";
import { fontScaleFactor, useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

const terminalThemes: Record<AppTheme, ITheme> = {
  dark: {
    background: "#151817",
    foreground: "#d7dad7",
    cursor: "#e7bf65",
    cursorAccent: "#151817",
    selectionBackground: "#49655b99",
    black: "#151817",
    red: "#f07d72",
    green: "#92b88a",
    yellow: "#e7bf65",
    blue: "#7da9b4",
    magenta: "#bf92b2",
    cyan: "#79b9ad",
    white: "#d7dad7",
    brightBlack: "#6f7671",
    brightRed: "#ff9a8f",
    brightGreen: "#afd3a7",
    brightYellow: "#f4d784",
    brightBlue: "#9bc7d2",
    brightMagenta: "#d9aecb",
    brightCyan: "#9bd4ca",
    brightWhite: "#f6f7f4",
  },
  light: {
    background: "#ffffff",
    foreground: "#202724",
    cursor: "#8b651e",
    cursorAccent: "#ffffff",
    selectionBackground: "#b9d2c6aa",
    black: "#202724",
    red: "#b23a36",
    green: "#3f7547",
    yellow: "#8b651e",
    blue: "#3e6f82",
    magenta: "#805579",
    cyan: "#39796e",
    white: "#e9eeeb",
    brightBlack: "#65716b",
    brightRed: "#d04e48",
    brightGreen: "#568e5e",
    brightYellow: "#a77b29",
    brightBlue: "#54869a",
    brightMagenta: "#976b90",
    brightCyan: "#4c9184",
    brightWhite: "#ffffff",
  },
  eye_care: {
    background: "#f2f6eb",
    foreground: "#2b342d",
    cursor: "#8d6927",
    cursorAccent: "#f2f6eb",
    selectionBackground: "#b5ccb1aa",
    black: "#2b342d",
    red: "#a8443e",
    green: "#4e7454",
    yellow: "#8d6927",
    blue: "#4b7180",
    magenta: "#775b76",
    cyan: "#47766c",
    white: "#e3eadc",
    brightBlack: "#687269",
    brightRed: "#c15850",
    brightGreen: "#648a69",
    brightYellow: "#a27c38",
    brightBlue: "#638796",
    brightMagenta: "#8e718d",
    brightCyan: "#5d8d82",
    brightWhite: "#f8faf4",
  },
};

const terminalPaletteColors: Record<TerminalPalette, Record<AppTheme, string>> = {
  graphite_gold: {
    dark: "#f4d27a",
    eye_care: "#8a6321",
    light: "#8b5f16",
  },
  forest_amber: {
    dark: "#a9d99b",
    eye_care: "#3f744b",
    light: "#2f6f45",
  },
  midnight_contrast: {
    dark: "#6dd7ff",
    eye_care: "#2f6e85",
    light: "#165e81",
  },
};

const ANSI_RESET = "\x1b[0m";
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control sequence parser intentionally matches ESC bytes.
const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const PROMPT_PATTERNS = [
  /\[[^\]\r\n]{1,200}\](?=[#$>:\s]|$)/u,
  /\b[\w.-]+@[\w.-]+(?:[:~/][^$#>\r\n]{0,80})?[$#>]\s?/u,
];

interface TerminalRenderState {
  commandColorActive: boolean;
  awaitingCommandEcho: boolean;
  promptBoundaryPending: boolean;
  promptTail: string;
  lastVisibleCharacter: string;
}

const MAX_PROMPT_TAIL = 256;

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") ?? false;
  textarea.remove();
  if (!copied) throw new Error("当前运行环境不允许写入系统剪贴板");
}

async function readTextFromClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  throw new Error("当前运行环境不允许读取系统剪贴板");
}

function buildTerminalTheme(theme: AppTheme, palette: TerminalPalette): ITheme {
  return {
    ...terminalThemes[theme],
    cursor: terminalPaletteColors[palette][theme],
  };
}

function ansiForeground(color: string): string {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `\x1b[38;2;${red};${green};${blue}m`;
}

function markTerminalInput(
  terminal: Terminal,
  theme: AppTheme,
  palette: TerminalPalette,
  state: TerminalRenderState,
  data: string,
): void {
  const hasPrintableInput =
    [...data].some((character) => character >= " " && character !== "\u007f") ||
    data.includes("\t");
  if (hasPrintableInput && !state.commandColorActive) {
    terminal.write(ansiForeground(terminalPaletteColors[palette][theme]));
    state.commandColorActive = true;
  }
  if (data.includes("\r") || data.includes("\n")) {
    state.awaitingCommandEcho = true;
  }
  if (data.includes("\u0003") || data.includes("\u001b")) {
    terminal.write(ANSI_RESET);
    state.commandColorActive = false;
    state.awaitingCommandEcho = false;
    state.promptBoundaryPending = false;
    state.promptTail = "";
  }
}

function cleanTerminalText(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: fallback for incomplete ANSI sequences.
  return value.replace(ANSI_ESCAPE, "").replace(/\x1b./gu, "");
}

function updateLastVisibleCharacter(state: TerminalRenderState, value: string): void {
  const clean = cleanTerminalText(value);
  for (const character of clean) {
    if (character === "\n" || character === "\r" || character >= " ") {
      state.lastVisibleCharacter = character;
    }
  }
}

function promptIndex(value: string): number {
  return PROMPT_PATTERNS.reduce((current, pattern) => {
    const match = pattern.exec(value);
    return match && match.index < current ? match.index : current;
  }, Number.POSITIVE_INFINITY);
}

function promptBoundary(value: string): { index: number; originalIndex: number } {
  const visibleCharacters: string[] = [];
  const originalIndices: number[] = [];
  let offset = 0;
  while (offset < value.length) {
    if (value[offset] === "\u001b") {
      const escapeSequence = value.slice(offset).match(ANSI_ESCAPE)?.[0];
      if (escapeSequence) {
        offset += escapeSequence.length;
        continue;
      }
    }
    originalIndices.push(offset);
    visibleCharacters.push(value[offset]);
    offset += 1;
  }
  const index = promptIndex(visibleCharacters.join(""));
  return {
    index,
    originalIndex: Number.isFinite(index) ? (originalIndices[index] ?? value.length) : value.length,
  };
}

function firstByte(value: Uint8Array, byte: number): number {
  return value.indexOf(byte);
}

function writeTerminalChunk(
  terminal: Terminal,
  bytes: Uint8Array,
  state: TerminalRenderState,
): void {
  let remaining = bytes;
  if (state.awaitingCommandEcho) {
    const newline = firstByte(remaining, 10);
    if (newline < 0) {
      terminal.write(remaining);
      updateLastVisibleCharacter(state, new TextDecoder().decode(remaining));
      return;
    }
    const echo = remaining.slice(0, newline + 1);
    terminal.write(echo);
    terminal.write(ANSI_RESET);
    updateLastVisibleCharacter(state, new TextDecoder().decode(echo));
    remaining = remaining.slice(newline + 1);
    state.commandColorActive = false;
    state.awaitingCommandEcho = false;
    state.promptTail = "";
    state.promptBoundaryPending = true;
  }

  if (!remaining.length) return;
  if (state.promptBoundaryPending) {
    const text = state.promptTail + new TextDecoder().decode(remaining);
    const boundary = promptBoundary(text);
    if (Number.isFinite(boundary.index)) {
      const before = text.slice(0, boundary.originalIndex);
      const after = text.slice(boundary.originalIndex);
      if (before) {
        terminal.write(before);
        updateLastVisibleCharacter(state, before);
      }
      if (state.lastVisibleCharacter !== "\n" && state.lastVisibleCharacter !== "\r") {
        terminal.write("\r\n");
      }
      terminal.write(after);
      updateLastVisibleCharacter(state, after);
      state.promptTail = "";
      state.promptBoundaryPending = false;
      return;
    }
    if (text.length > MAX_PROMPT_TAIL) {
      const safeEnd = text.length - MAX_PROMPT_TAIL;
      const safe = text.slice(0, safeEnd);
      terminal.write(safe);
      updateLastVisibleCharacter(state, safe);
      state.promptTail = text.slice(safeEnd);
    } else {
      state.promptTail = text;
    }
    return;
  }

  terminal.write(remaining);
  updateLastVisibleCharacter(state, new TextDecoder().decode(remaining));
}

interface TerminalViewProps {
  pane: PaneModel;
  profile: SessionProfile;
}

interface TerminalContextMenu {
  x: number;
  y: number;
  hasSelection: boolean;
}

function terminalScreenSnapshot(terminal: Terminal): TerminalScreenSnapshot {
  const buffer = terminal.buffer.active;
  const cursorLineIndex = buffer.baseY + buffer.cursorY;
  const cursorLine = buffer.getLine(cursorLineIndex);
  const visibleLines: string[] = [];
  for (let index = buffer.viewportY; index < buffer.viewportY + terminal.rows; index += 1) {
    const line = buffer.getLine(index);
    visibleLines.push(line?.translateToString(true) ?? "");
  }
  return {
    visibleText: visibleLines.join("\n"),
    cursorLine: cursorLine?.translateToString(true) ?? "",
    cursorLineBeforeCursor:
      cursorLine?.translateToString(false, 0, Math.min(buffer.cursorX, terminal.cols)) ?? "",
    cursorColumn: buffer.cursorX,
    updatedAtMs: Date.now(),
  };
}

export function TerminalView({ pane, profile }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionRef = useRef<string | null>(pane.sessionId);
  const screenSyncTimerRef = useRef<number | null>(null);
  const bindSession = useLayoutStore((state) => state.bindSession);
  const failConnection = useLayoutStore((state) => state.failConnection);
  const notify = useUiStore((state) => state.notify);
  const theme = useUiStore((state) => state.theme);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const terminalPalette = useUiStore((state) => state.terminalPalette);
  const fontScale = useUiStore((state) => state.fontScale);
  const terminalFontSize = useUiStore((state) => state.terminalFontSize);
  const xtermFontSize = terminalFontSize / fontScaleFactor[fontScale];
  const xtermFontSizeRef = useRef(xtermFontSize);
  xtermFontSizeRef.current = xtermFontSize;
  const terminalPaletteRef = useRef(terminalPalette);
  terminalPaletteRef.current = terminalPalette;
  const renderStateRef = useRef<TerminalRenderState>({
    commandColorActive: false,
    awaitingCommandEcho: false,
    promptBoundaryPending: false,
    promptTail: "",
    lastVisibleCharacter: "",
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null);

  const syncTerminalScreen = useCallback(() => {
    const terminal = terminalRef.current;
    const sessionId = sessionRef.current;
    if (!terminal || !sessionId) return;
    void terminalScreenUpdate(sessionId, terminalScreenSnapshot(terminal)).catch(() => undefined);
  }, []);

  const scheduleTerminalScreenSync = useCallback(() => {
    if (screenSyncTimerRef.current !== null) {
      window.clearTimeout(screenSyncTimerRef.current);
    }
    screenSyncTimerRef.current = window.setTimeout(() => {
      screenSyncTimerRef.current = null;
      syncTerminalScreen();
    }, 40);
  }, [syncTerminalScreen]);

  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    renderStateRef.current = {
      commandColorActive: false,
      awaitingCommandEcho: false,
      promptBoundaryPending: false,
      promptTail: "",
      lastVisibleCharacter: "",
    };
    const channel = createChannel<ArrayBuffer>();
    channel.onmessage = (buffer) => {
      const bytes = new Uint8Array(buffer);
      writeTerminalChunk(terminal, bytes, renderStateRef.current);
      scheduleTerminalScreenSync();
      const sessionId = sessionRef.current;
      if (sessionId) {
        publishTerminalOutput({
          sessionId,
          dataUtf8: new TextDecoder().decode(bytes),
        });
      }
    };
    try {
      const session = await sessionConnect(profile.id, terminal.cols, terminal.rows, channel);
      const paneExists = useLayoutStore
        .getState()
        .tabs.some((tab) => tab.panes.some((candidate) => candidate.id === pane.id));
      if (!paneExists) {
        await sessionDisconnect(session.session_id).catch(() => undefined);
        return;
      }
      sessionRef.current = session.session_id;
      bindSession(pane.id, session);
      scheduleTerminalScreenSync();
    } catch (error) {
      const message = formatIpcError(error, "会话连接失败：未返回可读的错误信息");
      notify(message, "error");
      failConnection(pane.id, message);
    }
  }, [bindSession, failConnection, notify, pane.id, profile.id, scheduleTerminalScreenSync]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace',
      fontSize: xtermFontSizeRef.current,
      lineHeight: 1.22,
      scrollback: 10_000,
      theme: buildTerminalTheme(themeRef.current, terminalPaletteRef.current),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(host);
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // Canvas rendering remains active when WebGL is unavailable.
    }
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;
    fit.fit();

    const input = terminal.onData((data) => {
      markTerminalInput(
        terminal,
        themeRef.current,
        terminalPaletteRef.current,
        renderStateRef.current,
        data,
      );
      const sessionId = sessionRef.current;
      if (sessionId)
        void terminalWrite(sessionId, data).catch(() => notify("终端写入失败", "error"));
      scheduleTerminalScreenSync();
    });
    const handleTerminalInput = (event: Event) => {
      const detail = (event as CustomEvent<TerminalInputEventDetail>).detail;
      if (!detail || detail.sessionId !== sessionRef.current) return;
      markTerminalInput(
        terminal,
        themeRef.current,
        terminalPaletteRef.current,
        renderStateRef.current,
        detail.dataUtf8,
      );
      scheduleTerminalScreenSync();
    };
    window.addEventListener("myterm:terminal-input", handleTerminalInput);
    const closeContextMenu = (event: Event) => {
      if ((event.target as Element | null)?.closest(".terminal-context-menu")) return;
      setContextMenu(null);
    };
    const closeContextMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeContextMenuOnEscape);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!event.ctrlKey || !event.shiftKey) return true;
      if (event.code === "KeyC" && terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if (event.code === "KeyV") {
        void navigator.clipboard.readText().then((text) => terminal.paste(text));
        return false;
      }
      if (event.code === "KeyF") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      const sessionId = sessionRef.current;
      if (sessionId) void terminalResize(sessionId, terminal.cols, terminal.rows);
    });
    observer.observe(host);
    void connect();

    return () => {
      if (screenSyncTimerRef.current !== null) {
        window.clearTimeout(screenSyncTimerRef.current);
        screenSyncTimerRef.current = null;
      }
      observer.disconnect();
      window.removeEventListener("myterm:terminal-input", handleTerminalInput);
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [connect, notify, scheduleTerminalScreenSync]);

  useEffect(() => {
    if (terminalRef.current)
      terminalRef.current.options.theme = buildTerminalTheme(theme, terminalPalette);
  }, [terminalPalette, theme]);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.fontSize = xtermFontSize;
    fitRef.current?.fit();
  }, [xtermFontSize]);

  const disconnected = pane.state === "disconnected" || pane.state === "failed";

  return (
    <div className="terminal-wrap">
      {searchOpen ? (
        <div className="terminal-search">
          <Icon name="search" />
          <input
            onChange={(event) => {
              setSearchValue(event.target.value);
              searchRef.current?.findNext(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") searchRef.current?.findNext(searchValue);
              if (event.key === "Escape") setSearchOpen(false);
            }}
            placeholder="查找终端输出"
            value={searchValue}
          />
          <button
            aria-label="关闭搜索"
            className="icon-button"
            onClick={() => setSearchOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}
      <div
        aria-label="终端会话"
        className="terminal-host"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            hasSelection: terminalRef.current?.hasSelection() ?? false,
          });
        }}
        ref={hostRef}
        role="application"
      />
      {contextMenu
        ? createPortal(
            <div
              aria-label="终端上下文菜单"
              className="terminal-context-menu"
              onContextMenu={(event) => event.preventDefault()}
              role="menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                disabled={!contextMenu.hasSelection}
                onClick={() => {
                  const terminal = terminalRef.current;
                  const selection = terminal?.getSelection() ?? "";
                  if (!selection) return;
                  void copyTextToClipboard(selection)
                    .then(() => setContextMenu(null))
                    .catch(() => notify("复制终端内容失败", "error"));
                }}
                role="menuitem"
                type="button"
              >
                复制
              </button>
              <button
                onClick={() => {
                  void readTextFromClipboard()
                    .then((text) => {
                      terminalRef.current?.paste(text);
                      setContextMenu(null);
                    })
                    .catch(() => notify("读取剪贴板失败", "error"));
                }}
                role="menuitem"
                type="button"
              >
                粘贴
              </button>
              <button
                onClick={() => {
                  terminalRef.current?.selectAll();
                  setContextMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                全选
              </button>
              <button
                disabled={!contextMenu.hasSelection}
                onClick={() => {
                  terminalRef.current?.clearSelection();
                  setContextMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                清除选择
              </button>
            </div>,
            document.body,
          )
        : null}
      {disconnected ? (
        <div
          aria-live="assertive"
          className="disconnect-overlay"
          role={pane.state === "failed" ? "alert" : "status"}
        >
          <span className="disconnect-icon">↻</span>
          <strong>{pane.state === "failed" ? "连接失败" : "会话已断开"}</strong>
          <pre>{pane.error ?? "会话已断开，可以重新连接。"}</pre>
          <div className="disconnect-actions">
            <button className="button button-primary" onClick={() => void connect()} type="button">
              重新连接
            </button>
            {pane.error ? (
              <button
                className="button button-secondary"
                onClick={() =>
                  void copyTextToClipboard(pane.error ?? "")
                    .then(() => notify("连接错误已复制", "success"))
                    .catch(() => notify("复制连接错误失败", "error"))
                }
                type="button"
              >
                复制错误
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {pane.state === "connecting" ? (
        <div className="terminal-connecting">
          <span className="spinner" /> 正在连接 {profile.name}
        </div>
      ) : null}
    </div>
  );
}
