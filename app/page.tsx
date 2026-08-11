"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ChatPanel, {
  ChatMsg,
  Session,
  Quiz,
  Step,
} from "@/components/ChatPanel";

const CANVAS_URL = process.env.NEXT_PUBLIC_CANVAS_URL ?? "http://localhost:3000";
const STORAGE_KEY = "teachagent.sessions.v1";

type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMsg[];
  preview: string;
  guidedMode?: boolean;
};

function loadSessions(): Record<string, StoredSession> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSessions(sessions: Record<string, StoredSession>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* ignore quota */
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function deriveTitle(messages: ChatMsg[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New session";
  const t = firstUser.text.slice(0, 40).trim();
  return t || "New session";
}

function derivePreview(messages: ChatMsg[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return lastAssistant?.text.slice(0, 80) ?? "";
}

export default function Home() {
  const [sessions, setSessions] = useState<Record<string, StoredSession>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [activeStep, setActiveStep] = useState<Step | null>(null);
  const [answeredQuiz, setAnsweredQuiz] = useState<{
    quiz: Quiz;
    userAnswer: string;
  } | null>(null);
  const [revealHint, setRevealHint] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>({
    ok: true,
    text: `Canvas: ${CANVAS_URL}`,
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load sessions on mount
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    const ids = Object.keys(loaded).sort(
      (a, b) => loaded[b].createdAt - loaded[a].createdAt,
    );
    if (ids.length > 0) {
      const latest = ids[0];
      setCurrentSessionId(latest);
      setMessages(loaded[latest].messages);
      if (loaded[latest].guidedMode) setGuidedMode(true);
    } else {
      const fresh = newId();
      setCurrentSessionId(fresh);
    }
  }, []);

  // Persist messages + guided mode to current session
  useEffect(() => {
    if (!currentSessionId) return;
    setSessions((prev) => {
      const existing = prev[currentSessionId];
      const updated: StoredSession = {
        id: currentSessionId,
        title: existing?.title || deriveTitle(messages),
        createdAt: existing?.createdAt || Date.now(),
        messages,
        preview: derivePreview(messages),
        guidedMode,
      };
      const next = { ...prev, [currentSessionId]: updated };
      saveSessions(next);
      return next;
    });
  }, [messages, currentSessionId, guidedMode]);

  const send = useCallback(
    async (text: string) => {
      const userMsg: ChatMsg = { role: "user", text };

      // In guided mode, treat input as quiz answer
      if (guidedMode && activeQuiz && !answeredQuiz) {
        const letterMatch = text.match(/^[A-Da-d]/);
        const letter = letterMatch
          ? letterMatch[0].toUpperCase()
          : text.trim().toUpperCase().slice(0, 1);
        setAnsweredQuiz({ quiz: activeQuiz, userAnswer: letter });
        // Send the user's answer to Claude as a regular message
        // Claude will return the next step (or retry)
        // Continue with normal send
      }

      const allMessages = [...messages, userMsg];
      setMessages(allMessages);
      setStreaming(true);
      setActiveQuiz(null);
      setRevealHint(false);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: allMessages.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.text,
            })),
            guidedMode,
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
              } else if (name === "quiz") {
                setActiveQuiz(parsed as Quiz);
                setAnsweredQuiz(null);
              } else if (name === "step") {
                setActiveStep(parsed as Step);
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
    },
    [messages, guidedMode, activeQuiz, answeredQuiz],
  );

  const clearCanvas = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "clear_canvas" },
      CANVAS_URL,
    );
  };

  const handleSelectSession = (id: string) => {
    setCurrentSessionId(id);
    setMessages(sessions[id]?.messages ?? []);
    setGuidedMode(sessions[id]?.guidedMode ?? false);
    setActiveQuiz(null);
    setAnsweredQuiz(null);
    setActiveStep(null);
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const next = { ...prev };
      delete next[id];
      saveSessions(next);
      return next;
    });
    if (currentSessionId === id) {
      const remaining = Object.keys(sessions)
        .filter((sid) => sid !== id)
        .sort((a, b) => sessions[b].createdAt - sessions[a].createdAt);
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0]);
        setMessages(sessions[remaining[0]].messages);
      } else {
        const fresh = newId();
        setCurrentSessionId(fresh);
        setMessages([]);
      }
    }
  };

  const handleNewSession = () => {
    const fresh = newId();
    setCurrentSessionId(fresh);
    setMessages([]);
    setActiveQuiz(null);
    setAnsweredQuiz(null);
    setActiveStep(null);
    clearCanvas();
  };

  const handleToggleGuided = () => {
    const next = !guidedMode;
    setGuidedMode(next);
    // Reset quiz/step state on toggle change
    if (next) {
      // Turning ON: reset conversation to fresh start
      handleNewSession();
      setMessages([]);
    } else {
      setActiveQuiz(null);
      setAnsweredQuiz(null);
      setActiveStep(null);
    }
  };

  const handleQuizAnswer = (letter: string) => {
    if (!activeQuiz) return;
    setAnsweredQuiz({ quiz: activeQuiz, userAnswer: letter });
    // Auto-send the answer as a message to Claude
    send(`My answer is ${letter}`);
  };

  const handleRevealHint = () => setRevealHint(true);

  const sessionList: Session[] = Object.values(sessions)
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messages.filter((m) => m.role !== "system").length,
      preview: s.preview,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);

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
        sessions={sessionList}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onNewSession={handleNewSession}
        guidedMode={guidedMode}
        onToggleGuided={handleToggleGuided}
        activeQuiz={activeQuiz}
        activeStep={activeStep}
        answeredQuiz={answeredQuiz}
        onQuizAnswer={handleQuizAnswer}
        revealHint={revealHint}
        onRevealHint={handleRevealHint}
      />
    </div>
  );
}
