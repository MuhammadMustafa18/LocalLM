"use client";

import { useState, useRef, useEffect } from "react";

export type ChatMsg = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  preview: string;
};

type Tab = "chat" | "sessions";

export default function ChatPanel({
  messages,
  onSend,
  streaming,
  onClearCanvas,
  status,
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  streaming: boolean;
  onClearCanvas: () => void;
  status?: { ok: boolean; text: string };
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!input.trim() || streaming) return;
    onSend(input.trim());
    setInput("");
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <aside className="chat-panel">
      {/* ===== Brand header ===== */}
      <div className="sidebar-header">
        <div className="brand-mark">
          <div className="brand-logo">T</div>
          <div>
            <div className="brand-name">TeachAgent</div>
            <div className="brand-tag">Visual learning, AI-assisted</div>
          </div>
        </div>
      </div>

      {/* ===== pill-tab group: Chat | Sessions ===== */}
      <div className="pill-tab-group" role="tablist">
        <button
          className={`pill-tab ${tab === "chat" ? "pill-tab-active" : ""}`}
          onClick={() => setTab("chat")}
          role="tab"
          aria-selected={tab === "chat"}
        >
          Chat
        </button>
        <button
          className={`pill-tab ${tab === "sessions" ? "pill-tab-active" : ""}`}
          onClick={() => setTab("sessions")}
          role="tab"
          aria-selected={tab === "sessions"}
        >
          Sessions
          {sessions.length > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: "0.7rem",
                opacity: 0.7,
              }}
            >
              {sessions.length}
            </span>
          )}
        </button>
      </div>

      {/* ===== Tab content ===== */}
      {tab === "chat" ? (
        <>
          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="msg system">
                Type a topic — e.g.{" "}
                <span style={{ color: "var(--color-ink)" }}>
                  "phones ki working samjhao"
                </span>
                . Tu aur AI dono canvas pe draw kar sakte ho — WebSocket se sync
                hota hai.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {streaming && (
              <div
                className="msg assistant"
                style={{ color: "var(--color-slate)" }}
              >
                <span>drawing on canvas…</span>
              </div>
            )}
          </div>

          {status && (
            <div className={`status-bar ${status.ok ? "ok" : "err"}`}>
              <span className="status-dot" />
              <span>{status.text}</span>
            </div>
          )}

          <div className="chat-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Ask anything…"
              disabled={streaming}
            />
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={streaming || !input.trim()}
            >
              Send
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sessions-list">
            <button
              className="btn btn-secondary"
              onClick={onNewSession}
              style={{
                width: "100%",
                marginBottom: "var(--s-md)",
                justifyContent: "center",
              }}
            >
              + New session
            </button>

            {sessions.length === 0 ? (
              <div className="sessions-empty">
                No saved sessions yet.
                <br />
                <br />
                Conversations auto-save when you send a message.
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`session-card ${
                    s.id === currentSessionId ? "session-card-active" : ""
                  }`}
                  onClick={() => {
                    onSelectSession(s.id);
                    setTab("chat");
                  }}
                >
                  <div className="session-card-title">{s.title}</div>
                  <div className="session-card-meta">
                    <span>{formatTime(s.createdAt)}</span>
                    <span>·</span>
                    <span>{s.messageCount} msgs</span>
                    {s.messageCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="session-card-badge">Active</span>
                      </>
                    )}
                  </div>
                  {s.preview && (
                    <div
                      style={{
                        fontSize: "var(--t-micro)",
                        color: "var(--color-slate)",
                        marginTop: "var(--s-xs)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.preview}
                    </div>
                  )}
                  <button
                    className="session-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    aria-label="Delete session"
                    title="Delete session"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="chat-input">
            <button
              className="btn btn-tertiary"
              onClick={onClearCanvas}
              style={{ width: "100%" }}
            >
              Clear canvas
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
