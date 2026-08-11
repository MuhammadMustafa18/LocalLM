"use client";

import { useState, useRef } from "react";
import ChatPanel, { ChatMsg } from "@/components/ChatPanel";

const CANVAS_URL = process.env.NEXT_PUBLIC_CANVAS_URL ?? "http://localhost:3000";

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>({
    ok: true,
    text: `Canvas: ${CANVAS_URL}`,
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = async (text: string) => {
    const userMsg: ChatMsg = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.text,
          })),
        }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        setMessages((prev) => [
          ...prev,
          { role: "system", text: `Error: ${resp.status} ${resp.statusText}` },
        ]);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const evt of events) {
          const lines = evt.split("\n");
          let name = "";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) name = line.slice(7);
            else if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!name || !data) continue;
          try {
            const parsed = JSON.parse(data);
            if (name === "text") {
              assistantText += parsed.delta ?? "";
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant", text: assistantText },
                  ];
                }
                return [...prev, { role: "assistant", text: assistantText }];
              });
            } else if (name === "status") {
              setMessages((prev) => [
                ...prev,
                { role: "system", text: parsed.text ?? "" },
              ]);
            } else if (name === "tool_result") {
              if (parsed.isError) {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "system",
                    text: `MCP tool error: ${parsed.raw?.slice(0, 200) ?? "unknown"}`,
                  },
                ]);
              } else {
                setStatus({
                  ok: true,
                  text: `Canvas updated — ${parsed.raw?.slice(0, 80) ?? "tool ok"}`,
                });
              }
            } else if (name === "error") {
              setMessages((prev) => [
                ...prev,
                { role: "system", text: `Error: ${parsed.message}` },
              ]);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      if (String(err).includes("abort")) return;
      setMessages((prev) => [
        ...prev,
        { role: "system", text: `Failed: ${String(err)}` },
      ]);
    } finally {
      setStreaming(false);
    }
  };

  const clearCanvas = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "clear_canvas" },
      CANVAS_URL,
    );
    setMessages([]);
  };

  return (
    <div className="app">
      <div className="canvas-panel">
        <iframe
          ref={iframeRef}
          src={CANVAS_URL}
          title="Excalidraw Canvas"
          allow="clipboard-read; clipboard-write"
        />
      </div>
      <ChatPanel
        messages={messages}
        onSend={send}
        streaming={streaming}
        onClearCanvas={clearCanvas}
        status={status}
      />
    </div>
  );
}
