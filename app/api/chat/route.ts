// Chat API — Hinglish chat + Excalidraw elements via:
//   1. Anthropic (MiniMax proxy) for chat text + element JSON
//   2. Canvas REST API (localhost:3000) to push elements, WebSocket syncs to UI

import Anthropic from "@anthropic-ai/sdk";
import { RECALL_CHEAT_SHEET } from "@/lib/recall-cheatsheet";

export const runtime = "nodejs";
export const maxDuration = 60;

const CANVAS_URL = process.env.CANVAS_URL ?? "http://localhost:3000";

const SYSTEM_PROMPT = `You are TeachAgent — a Hinglish (Hindi+English mix) visual tutor. The user gives you a topic, you explain by drawing on an Excalidraw canvas.

Respond with ONLY valid JSON (no markdown, no code fences):
{"text":"<1-2 sentence Hinglish ack for chat>","elements":[<array of Excalidraw elements>]}

- "text" goes in chat sidebar — brief, conversational, Hinglish
- "elements" is the COMPLETE diagram — start with cameraUpdate, then draw progressively
- For follow-ups, re-emit the FULL diagram. Use {"type":"delete","ids":"id1,id2"} to remove parts (place AFTER what to remove).
- If user asks about something already drawn (e.g. "ye wala box kya hai?"), look at the CURRENT CANVAS below and reference those elements. You can re-render with highlights (change strokeColor, add red border) or re-position for clarity.
- User can also draw manually — always re-emit the full diagram so manual drawings are preserved.

${RECALL_CHEAT_SHEET}
`;

// Guided mode system prompt — teaches step-by-step with MCQ quizzes
const GUIDED_SYSTEM_PROMPT = `You are TeachAgent in GUIDED LEARNING MODE — an interactive Hinglish tutor that teaches topics step-by-step through diagrams + multiple-choice quizzes.

## Flow
1. On the FIRST user message, plan the topic into 3-7 steps and respond with:
   {"text":"<Hinglish intro + plan: 'Aaj hum X seekhenge — 4 steps mein. Chalo shuru karte hain! Step 1: ...'>","elements":[<step 1 diagram>],"quiz":{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A","hint":"..."},"step":1,"total":4,"phase":"teach"}

2. User replies with their answer (e.g. "B", "B) ISP", or text).
3. Evaluate the answer:
   - CORRECT: brief congrats + next step. Respond: {"text":"<correct! now step N>","elements":[<new diagram>],"quiz":{...},"step":N,"total":4,"phase":"teach"}
   - WRONG: shorter/simpler diagram + hint. Respond: {"text":"<almost! let me show simpler>","elements":[<simpler diagram>],"quiz":{...with hint>","step":N,"total":4,"phase":"retry"}
4. After last step: {"text":"🎉 Shabaash! Complete ho gaya. Summary: ...","elements":[<final overview diagram>],"step":N,"total":N,"phase":"done","summary":"..."}

## Rules
- "text" is Hinglish, conversational, 1-2 sentences
- "elements" is the FULL Excalidraw diagram (cameraUpdate FIRST, then draw progressively)
- "quiz" MUST have 4 options (A/B/C/D). Mark the correct one with letter only.
- "hint" reveals on second wrong answer — reveal only when needed (set "hint":"shown" after showing)
- "step" = current step number, "total" = total steps in plan
- "phase" = "teach" (normal) | "retry" (after wrong answer, simpler diagram) | "done" (topic complete)
- For "retry" phase: SIMPLIFY the diagram (fewer elements, clearer labels, highlight key part)
- "summary" only on done phase — bullet list of what was learned

## Response shape (CRITICAL — always this exact JSON, no markdown):
{"text":"...","elements":[...],"quiz":{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A","hint":"..."},"step":1,"total":4,"phase":"teach"}

${RECALL_CHEAT_SHEET}
`;

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const body = await req.json();
  const messages: IncomingMessage[] = body.messages ?? [];
  const guidedMode: boolean = body.guidedMode ?? false;

  if (!process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) missing",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // 0. Fetch current canvas state for context (so Claude knows what's drawn)
        let canvasContext = "";
        send("status", { text: "📡 Loading canvas context…" });
        try {
          const elsResp = await fetch(`${CANVAS_URL}/api/elements`);
          const elsData = await elsResp.json();
          if (elsData?.elements?.length) {
            const summary = elsData.elements.map((e: any) => {
              const label =
                e.label?.text ??
                (e.text && !e.containerId ? e.text : null) ??
                "";
              return `- ${e.type}${e.id ? ` (id: ${e.id})` : ""}${label ? ` "${label}"` : ""} @ (${e.x},${e.y}) ${e.width ? `${e.width}×${e.height}` : ""}`;
            });
            canvasContext = `\n\nCURRENT CANVAS (${elsData.elements.length} elements):\n${summary.join("\n")}\n\nUser may reference these. Preserve all current elements when re-emitting, unless they ask to delete specific ones by id.`;
            send("status", {
              text: `📡 Canvas: ${elsData.elements.length} elements loaded`,
            });
          } else {
            send("status", { text: "📡 Canvas: empty (fresh start)" });
          }
        } catch {
          send("status", { text: "⚠️ Canvas offline — proceeding without context" });
        }

        // 1. Get chat text + elements from Claude
        send("status", { text: "� Asking Claude…" });
        let convo = messages.map((m) => ({ role: m.role, content: m.content }));
        let finalText = "";
        let finalElements: unknown[] | null = null;

        // 1a. Detect topic — use the latest user message to compute a stable offset
        const latestUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const topicSlug = latestUserMsg
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .trim()
          .split(/\s+/)
          .slice(0, 3)
          .join("_")
          .slice(0, 30) || "topic";
        // Hash to 4 buckets → different x-offset per topic (so each topic lands in its own canvas region)
        let topicHash = 0;
        for (let i = 0; i < topicSlug.length; i++) {
          topicHash = (topicHash * 31 + topicSlug.charCodeAt(i)) >>> 0;
        }
        const TOPIC_BUCKETS = [
          { x: 0,    y: 0 },    // bucket 0 — top-left
          { x: 1300, y: 0 },    // bucket 1 — top-right (canvas is wide, shift right)
          { x: 0,    y: 950 },  // bucket 2 — bottom-left
          { x: 1300, y: 950 },  // bucket 3 — bottom-right
        ];
        const topicOffset = TOPIC_BUCKETS[topicHash % TOPIC_BUCKETS.length];
        send("status", {
          text: `📍 Topic "${topicSlug}" → offset (${topicOffset.x}, ${topicOffset.y})`,
        });

        for (let turn = 0; turn < 3; turn++) {
          const resp = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 8192,
            system: (guidedMode ? GUIDED_SYSTEM_PROMPT : SYSTEM_PROMPT) + canvasContext,
            messages: convo,
          });

          let fullText = "";
          for (const block of resp.content) {
            if (block.type === "text") fullText += block.text;
          }
          convo = [...convo, { role: "assistant", content: fullText }];

          // Try to extract JSON from response (handle markdown fences + extra text)
          let cleaned = fullText.trim();
          cleaned = cleaned
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/```\s*$/, "")
            .trim();

          // Extract first JSON object — find matching outer brace (handle nested)
          const firstBrace = cleaned.indexOf("{");
          if (firstBrace !== -1) {
            let depth = 0;
            let inStr = false;
            let esc = false;
            let endIdx = -1;
            for (let i = firstBrace; i < cleaned.length; i++) {
              const ch = cleaned[i];
              if (esc) { esc = false; continue; }
              if (ch === "\\") { esc = true; continue; }
              if (ch === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (ch === "{") depth++;
              else if (ch === "}") {
                depth--;
                if (depth === 0) { endIdx = i; break; }
              }
            }
            if (endIdx !== -1) cleaned = cleaned.slice(firstBrace, endIdx + 1);
          }

          try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed?.elements)) {
              finalElements = parsed.elements;
              // Apply topic offset + auto-group to drawn elements (skip cameraUpdate and delete)
              finalElements.forEach((e: any) => {
                if (
                  e &&
                  e.type !== "cameraUpdate" &&
                  e.type !== "delete"
                ) {
                  // Apply x/y offset
                  if (typeof e.x === "number") e.x = e.x + topicOffset.x;
                  if (typeof e.y === "number") e.y = e.y + topicOffset.y;
                  // Auto-add groupId if missing (forces grouping)
                  if (!Array.isArray(e.groupIds) || e.groupIds.length === 0) {
                    e.groupIds = [`g_${topicSlug}`];
                  }
                }
              });
              if (typeof parsed?.text === "string") finalText = parsed.text;
              const drawnCount = finalElements.filter(
                (e: any) => e?.type !== "delete" && e?.type !== "cameraUpdate",
              ).length;
              const delCount = finalElements.filter(
                (e: any) => e?.type === "delete",
              ).length;
              send("status", {
                text: `✅ Claude returned: ${drawnCount} drawn${delCount ? `, ${delCount} deletes` : ""}`,
              });

              // Guided mode: emit quiz + step info
              if (guidedMode) {
                if (parsed.quiz && typeof parsed.quiz === "object") {
                  send("quiz", parsed.quiz);
                }
                if (typeof parsed.step === "number") {
                  send("step", {
                    step: parsed.step,
                    total: parsed.total ?? null,
                    phase: parsed.phase ?? "teach",
                    summary: parsed.summary ?? null,
                  });
                }
              }
              break;
            }
            // Has text but no elements — likely clarifying question
            if (typeof parsed?.text === "string") {
              finalText = parsed.text;
              send("status", {
                text: "💬 Claude asked a clarifying question (no diagram)",
              });
              // Guided mode may still emit quiz + step without elements (e.g., done phase)
              if (guidedMode) {
                if (parsed.quiz && typeof parsed.quiz === "object") {
                  send("quiz", parsed.quiz);
                }
                if (typeof parsed.step === "number") {
                  send("step", {
                    step: parsed.step,
                    total: parsed.total ?? null,
                    phase: parsed.phase ?? "teach",
                    summary: parsed.summary ?? null,
                  });
                }
              }
              break;
            }
            convo = [
              ...convo,
              {
                role: "user",
                content:
                  'Please include "elements":[<excalidraw array>]. JSON only.',
              },
            ];
          } catch (err) {
            send("status", {
              text: `�️ JSON parse failed on turn ${turn + 1}, retrying…`,
            });
            convo = [
              ...convo,
              {
                role: "user",
                content:
                  'Your previous response was NOT valid JSON. Respond with ONLY valid JSON in this exact shape: {"text":"<hinglish>","elements":[<array>]} — no markdown, no prose, no explanations outside the JSON.',
              },
            ];
          }
        }

        if (finalText) send("text", { delta: finalText });

        // 1b. Normalize coordinates — clamp to visible canvas, fix clustering
        if (finalElements?.length) {
          const drawn = finalElements.filter(
            (e: any) => e?.type !== "delete" && e?.type !== "cameraUpdate",
          );

          // Clamp cameraUpdate size to fit standard visible canvas
          for (const e of finalElements) {
            if (e?.type === "cameraUpdate") {
              if (e.width > 1200) {
                send("status", {
                  text: `📐 Clamping camera ${e.width}×${e.height} → 1200×900`,
                });
                e.width = 1200;
                e.height = 900;
              }
            }
          }

          if (drawn.length >= 2) {
            const xs = drawn
              .map((e: any) => e.x)
              .filter((x: any) => typeof x === "number");
            const ys = drawn
              .map((e: any) => e.y)
              .filter((y: any) => typeof y === "number");
            const xRange = Math.max(...xs) - Math.min(...xs);
            const yRange = Math.max(...ys) - Math.min(...ys);

            // If elements are too clustered (range < 400px) or way out of bounds,
            // redistribute them across the canvas (1200×900)
            const CANVAS_W = 1200;
            const CANVAS_H = 900;
            const needsRedistribute =
              (xRange < 400 && yRange < 400 && drawn.length > 1) ||
              Math.max(...xs) > CANVAS_W + 200;

            if (needsRedistribute) {
              send("status", {
                text: `⚠️ Redistributing ${drawn.length} elements across 1200×900 canvas…`,
              });
              const cols = Math.min(drawn.length, Math.ceil(Math.sqrt(drawn.length)));
              const rows = Math.ceil(drawn.length / cols);
              const cellW = (CANVAS_W - 100) / cols;
              const cellH = (CANVAS_H - 100) / rows;
              drawn.forEach((el: any, i: number) => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                el.x = Math.round(50 + col * cellW);
                el.y = Math.round(50 + row * cellH);
              });
            }
          }
        }

        // 2. Push elements to canvas server
        if (finalElements?.length) {
          // Separate drawn elements from delete pseudo-elements
          const drawn = finalElements.filter((e: any) => e?.type !== "delete");
          const deletes = finalElements.filter((e: any) => e?.type === "delete");

          send("status", {
            text: `🗑️ Deleting ${deletes.length} element(s)…`,
          });
          // Apply deletes first via DELETE endpoint
          for (const d of deletes) {
            const ids = String((d as any).ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            for (const id of ids) {
              try {
                await fetch(`${CANVAS_URL}/api/elements/${id}`, {
                  method: "DELETE",
                });
              } catch {
                /* ignore */
              }
            }
          }

          // Set viewport from last cameraUpdate (if any) — auto-fit so diagram is visible
          const cam = [...drawn].reverse().find((e: any) => e?.type === "cameraUpdate");
          try {
            send("status", { text: "📷 Auto-fitting viewport…" });
            await fetch(`${CANVAS_URL}/api/viewport`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                scrollToContent: true,
                ...(cam
                  ? {
                      zoom: 1,
                      offsetX: cam.x ?? 0,
                      offsetY: cam.y ?? 0,
                    }
                  : {}),
              }),
            });
          } catch {
            /* canvas offline or no client */
          }

          // POST drawn elements (skip cameraUpdate which is viewport-only)
          const toCreate = drawn.filter((e: any) => e?.type !== "cameraUpdate");
          if (toCreate.length) {
            send("status", {
              text: `� Pushing ${toCreate.length} elements to canvas…`,
            });
            try {
              const resp = await fetch(`${CANVAS_URL}/api/elements/batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ elements: toCreate }),
              });
              const result = await resp.json();
              send("tool_result", {
                name: "create_view",
                raw: `Created ${result.count ?? toCreate.length} elements`,
                isError: !resp.ok,
              });
            } catch (err) {
              send("tool_result", {
                name: "create_view",
                raw: String(err).slice(0, 200),
                isError: true,
              });
            }
          } else {
            send("tool_result", {
              name: "create_view",
              raw: "No drawn elements (delete-only or camera-only update)",
              isError: false,
            });
          }
        }

        send("status", { text: "✨ Done" });
        send("done", {});
        controller.close();
      } catch (err) {
        send("error", { message: String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
