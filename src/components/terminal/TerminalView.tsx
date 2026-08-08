import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChannel,
  type SessionProfile,
  sessionConnect,
  sessionDisconnect,
  terminalResize,
  terminalWrite,
} from "../../ipc";
import type { PaneModel } from "../../store/layout";
import { useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

const terminalThemes: Record<"light" | "eye_care" | "dark", ITheme> = {
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

interface TerminalViewProps {
  pane: PaneModel;
  profile: SessionProfile;
}

export function TerminalView({ pane, profile }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionRef = useRef<string | null>(pane.sessionId);
  const bindSession = useLayoutStore((state) => state.bindSession);
  const failConnection = useLayoutStore((state) => state.failConnection);
  const notify = useUiStore((state) => state.notify);
  const theme = useUiStore((state) => state.theme);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    const channel = createChannel<ArrayBuffer>();
    channel.onmessage = (buffer) => terminal.write(new Uint8Array(buffer));
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "会话连接失败";
      notify(message, "error");
      failConnection(pane.id, message);
    }
  }, [bindSession, failConnection, notify, pane.id, profile.id]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.22,
      scrollback: 10_000,
      theme: terminalThemes.dark,
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
      const sessionId = sessionRef.current;
      if (sessionId)
        void terminalWrite(sessionId, data).catch(() => notify("终端写入失败", "error"));
    });
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
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [connect, notify]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalThemes[theme];
  }, [theme]);

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
      <div className="terminal-host" ref={hostRef} />
      {disconnected ? (
        <button className="disconnect-overlay" onClick={() => void connect()} type="button">
          <span className="disconnect-icon">↻</span>
          <strong>{pane.state === "failed" ? "连接失败" : "会话已断开"}</strong>
          <small>{pane.error ?? "点击重新连接"}</small>
        </button>
      ) : null}
      {pane.state === "connecting" ? (
        <div className="terminal-connecting">
          <span className="spinner" /> 正在连接 {profile.name}
        </div>
      ) : null}
    </div>
  );
}
