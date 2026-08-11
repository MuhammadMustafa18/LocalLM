"use client";

import { useState, useRef, useEffect } from "react";

export type ChatMsg = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type Quiz = {
  question: string;
  options: string[];
  correct: string;
  hint?: string;
};

export type Step = {
  step: number;
  total: number | null;
  phase: "teach" | "retry" | "done";
  summary?: string | null;
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
  guidedMode,
  onToggleGuided,
  activeQuiz,
  activeStep,
  answeredQuiz,
  onQuizAnswer,
  revealHint,
  onRevealHint,
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
  guidedMode: boolean;
  onToggleGuided: () => void;
  activeQuiz: Quiz | null;
  activeStep: Step | null;
  answeredQuiz: { quiz: Quiz; userAnswer: string } | null;
  onQuizAnswer: (optionLetter: string) => void;
  revealHint: boolean;
  onRevealHint: () => void;
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
          {/* Guided mode toggle row (above messages) */}
          <div
            style={{
              padding: "var(--s-md) var(--s-xl) var(--s-xs)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--s-md)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--s-sm)",
              }}
            >
              <span style={{ fontSize: "var(--t-body-sm)", color: "var(--color-slate)" }}>
                Guided learning
              </span>
              {activeStep && (
                <span className="badge badge-new" style={{ fontSize: "var(--t-micro)" }}>
                  Step {activeStep.step}/{activeStep.total ?? "?"}
                  {activeStep.phase === "retry" && " • retry"}
                  {activeStep.phase === "done" && " • done"}
                </span>
              )}
            </div>
            <button
              role="switch"
              aria-checked={guidedMode}
              onClick={onToggleGuided}
              className={`toggle ${guidedMode ? "toggle-on" : ""}`}
              title={
                guidedMode
                  ? "Guided mode ON — step-by-step with quizzes"
                  : "Guided mode OFF — free chat"
              }
            >
              <span className="toggle-thumb" />
            </button>
          </div>

          {/* Guided progress bar */}
          {guidedMode && activeStep && activeStep.total && (
            <div
              style={{
                padding: "0 var(--s-xl) var(--s-sm)",
              }}
            >
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${(activeStep.step / activeStep.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="msg system">
                {guidedMode ? (
                  <>
                    Guided mode <b>ON</b>. Type a topic to start — e.g.{" "}
                    <span style={{ color: "var(--color-ink)" }}>
                      "photosynthesis samjhao"
                    </span>
                    . Main step-by-step diagram + MCQ ke saath sikhata hoon.
                  </>
                ) : (
                  <>
                    Type a topic — e.g.{" "}
                    <span style={{ color: "var(--color-ink)" }}>
                      "phones ki working samjhao"
                    </span>
                    . Tu aur AI dono canvas pe draw kar sakte ho.
                  </>
                )}
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
                <span>{guidedMode ? "preparing step…" : "drawing on canvas…"}</span>
              </div>
            )}

            {/* ===== MCQ Quiz Card ===== */}
            {activeQuiz && !answeredQuiz && (
              <QuizCard
                quiz={activeQuiz}
                onAnswer={onQuizAnswer}
                streaming={streaming}
                revealHint={revealHint}
                onRevealHint={onRevealHint}
              />
            )}

            {/* ===== Answer feedback ===== */}
            {answeredQuiz && (
              <AnswerFeedback
                quiz={answeredQuiz.quiz}
                userAnswer={answeredQuiz.userAnswer}
              />
            )}

            {/* ===== Summary on done ===== */}
            {activeStep?.phase === "done" && activeStep.summary && (
              <div
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-brand-coral), var(--color-brand-magenta))",
                  color: "var(--color-on-dark)",
                  padding: "var(--s-md) var(--s-lg)",
                  borderRadius: "var(--r-lg)",
                  fontSize: "var(--t-body-sm)",
                  margin: "var(--s-sm) 0",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: "var(--s-xs)",
                    fontSize: "var(--t-card-title)",
                  }}
                >
                  Topic Complete
                </div>
                {activeStep.summary}
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
              placeholder={
                guidedMode && activeQuiz
                  ? "Type A, B, C, or D to answer…"
                  : guidedMode
                    ? "Ask the next step or type your answer…"
                    : "Ask anything…"
              }
              disabled={streaming}
            />
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={streaming || !input.trim()}
            >
              {guidedMode && activeQuiz && !answeredQuiz ? "Answer" : "Send"}
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

// ===== Quiz Card Component =====
function QuizCard({
  quiz,
  onAnswer,
  streaming,
  revealHint,
  onRevealHint,
}: {
  quiz: Quiz;
  onAnswer: (letter: string) => void;
  streaming: boolean;
  revealHint: boolean;
  onRevealHint: () => void;
}) {
  return (
    <div className="quiz-card">
      <div className="quiz-card-label">
        <span className="badge badge-beta">QUIZ</span>
        <span style={{ fontSize: "var(--t-micro)", color: "var(--color-slate)" }}>
          Tap an option to answer
        </span>
      </div>
      <div className="quiz-question">{quiz.question}</div>
      <div className="quiz-options">
        {quiz.options.map((opt, i) => {
          const letter = String.fromCharCode(65 + i); // A, B, C, D
          return (
            <button
              key={i}
              className="quiz-option"
              onClick={() => onAnswer(letter)}
              disabled={streaming}
            >
              <span className="quiz-option-letter">{letter}</span>
              <span>{opt.replace(/^[A-D]\)\s*/, "")}</span>
            </button>
          );
        })}
      </div>
      {quiz.hint && (
        <div style={{ marginTop: "var(--s-sm)" }}>
          {revealHint ? (
            <div className="quiz-hint">💡 {quiz.hint}</div>
          ) : (
            <button
              className="btn btn-tertiary"
              onClick={onRevealHint}
              style={{ width: "100%", height: 32, fontSize: "var(--t-micro)" }}
            >
              Show hint
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Answer Feedback Component =====
function AnswerFeedback({
  quiz,
  userAnswer,
}: {
  quiz: Quiz;
  userAnswer: string;
}) {
  const isCorrect = userAnswer.toUpperCase() === quiz.correct.toUpperCase();
  const correctOption = quiz.options[
    ["A", "B", "C", "D"].indexOf(quiz.correct.toUpperCase())
  ];

  return (
    <div
      className={`quiz-feedback ${isCorrect ? "correct" : "wrong"}`}
    >
      <div style={{ fontWeight: 700, fontSize: "var(--t-body-sm)" }}>
        {isCorrect ? "✓ Sahi jawab!" : "✗ Galat jawab"}
      </div>
      <div style={{ fontSize: "var(--t-micro)", marginTop: "var(--s-xxs)" }}>
        You chose: <b>{userAnswer.toUpperCase()}</b>
        {!isCorrect && (
          <>
            {" · "}Correct: <b>{quiz.correct.toUpperCase()}</b> —{" "}
            {correctOption?.replace(/^[A-D]\)\s*/, "")}
          </>
        )}
      </div>
    </div>
  );
}
