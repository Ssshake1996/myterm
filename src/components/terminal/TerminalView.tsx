import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChannel,
  type SessionProfile,
  sessionConnect,
  terminalResize,
  terminalWrite,
} from "../../ipc";
import type { PaneModel } from "../../store/layout";
import { useLayoutStore } from "../../store/layout";
import { useUiStore } from "../../store/ui";
import { Icon } from "../shell/Icon";

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
  const updateSession = useLayoutStore((state) => state.updateSession);
  const notify = useUiStore((state) => state.notify);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    const channel = createChannel<ArrayBuffer>();
    channel.onmessage = (buffer) => terminal.write(new Uint8Array(buffer));
    try {
      const sessionId = await sessionConnect(profile.id, terminal.cols, terminal.rows, channel);
      sessionRef.current = sessionId;
      bindSession(pane.id, sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "会话连接失败";
      notify(message, "error");
      if (sessionRef.current) updateSession(sessionRef.current, "failed", message);
    }
  }, [bindSession, notify, pane.id, profile.id, updateSession]);

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
      theme: {
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
