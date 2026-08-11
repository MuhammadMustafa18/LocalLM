"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useMemo } from "react";

// Load Excalidraw client-only (touches window on import)
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((m) => m.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#aaa",
        }}
      >
        Loading canvas…
      </div>
    ),
  },
);

export type ExcalidrawElement = Record<string, unknown> & {
  id?: string;
  type: string;
};

export default function CanvasPanel({
  elements,
}: {
  elements: ExcalidrawElement[];
}) {
  // Filter out cameraUpdate + apply delete pseudo-elements
  const drawnElements = useMemo(() => {
    const deletedIds = new Set<string>();
    for (const e of elements) {
      if (
        e.type === "delete" &&
        typeof (e as Record<string, unknown>).ids === "string"
      ) {
        (e as Record<string, unknown>).ids
          .toString()
          .split(",")
          .forEach((id) => deletedIds.add(id.trim()));
      }
    }
    return elements
      .filter((e) => e.type !== "delete" && e.type !== "cameraUpdate")
      .filter((e) => !deletedIds.has((e.id as string) ?? ""));
  }, [elements]);

  if (!elements.length) {
    return (
      <div className="canvas-panel">
        <div className="empty-canvas">
          Canvas empty — chat mein topic pucho, diagram yahan draw hoga
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-panel" style={{ width: "100%", height: "100%" }}>
      <ExcalidrawWithData elements={drawnElements} />
    </div>
  );
}

// Inner component that has access to Excalidraw's imperative API
function ExcalidrawWithData({ elements }: { elements: ExcalidrawElement[] }) {
  // Use a key that changes when elements change — forces re-mount with new data
  // This is the most reliable way to update Excalidraw with new elements
  const signature = useMemo(
    () => elements.map((e) => `${e.id ?? ""}:${e.type}`).join("|"),
    [elements],
  );

  return (
    <Excalidraw
      key={signature}
      initialData={{
        elements: elements as never,
        appState: {
          viewBackgroundColor: "#ffffff",
        },
        scrollToContent: true,
      }}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          clearCanvas: false,
          toggleTheme: false,
        },
      }}
    />
  );
}
