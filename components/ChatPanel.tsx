"use client";

import { useState, useRef, useEffect } from "react";

export type ChatMsg = { role: "user" | "assistant" | "system"; text: string };

export default function ChatPanel({
  messages,
  onSend,
  streaming,
  onClearCanvas,
  status,
}: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  streaming: boolean;
  onClearCanvas: () => void;
  status?: { ok: boolean; text: string };
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!input.trim() || streaming) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>TeachAgent Chat</span>
        <button onClick={onClearCanvas}>Clear canvas</button>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="msg system">
            Type a topic — e.g. "phones ki working samjhao"
            <br />
            <br />
            Tu aur AI dono canvas pe draw kar sakte ho — WebSocket se sync hota hai.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {streaming && (
          <div className="msg assistant" style={{ color: "#888" }}>
            <span>drawing on canvas…</span>
          </div>
        )}
      </div>
      {status && (
        <div className={`status-bar ${status.ok ? "ok" : "err"}`}>
          {status.text}
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
        <button onClick={submit} disabled={streaming || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
