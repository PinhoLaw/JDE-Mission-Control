"use client";

import { useRef, useEffect, useCallback, useState } from "react";

const STORAGE_KEY = "cruze-panel-position";

interface Position {
  x: number;
  y: number;
}

interface UseDraggableOptions {
  /** Element reference for the draggable container */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Element reference for the drag handle (header) */
  handleRef: React.RefObject<HTMLElement | null>;
  /** Whether dragging is enabled */
  enabled?: boolean;
}

/**
 * Makes an element draggable by its handle.
 * Persists position to localStorage, supports mouse + touch,
 * and constrains to viewport bounds.
 */
export function useDraggable({
  containerRef,
  handleRef,
  enabled = true,
}: UseDraggableOptions) {
  const [position, setPosition] = useState<Position | null>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });

  // Load saved position from localStorage on mount
  useEffect(() => {
    if (!enabled) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const pos = JSON.parse(saved) as Position;
        // Validate it's still within viewport
        const maxX = window.innerWidth - 100;
        const maxY = window.innerHeight - 100;
        if (pos.x >= 0 && pos.x <= maxX && pos.y >= 0 && pos.y <= maxY) {
          setPosition(pos);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, [enabled]);

  // Clamp position to viewport bounds
  const clamp = useCallback(
    (x: number, y: number): Position => {
      const el = containerRef.current;
      if (!el) return { x, y };
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        x: Math.max(0, Math.min(x, vw - w)),
        y: Math.max(0, Math.min(y, vh - h)),
      };
    },
    [containerRef],
  );

  // Save position to localStorage
  const savePosition = useCallback((pos: Position) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Pointer move handler (shared by mouse and touch)
  const handlePointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging.current) return;
      const newX = clientX - dragOffset.current.x;
      const newY = clientY - dragOffset.current.y;
      const clamped = clamp(newX, newY);
      setPosition(clamped);
    },
    [clamp],
  );

  // Pointer up handler
  const handlePointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    // Save final position
    setPosition((pos) => {
      if (pos) savePosition(pos);
      return pos;
    });
  }, [savePosition]);

  useEffect(() => {
    if (!enabled) return;
    const handle = handleRef.current;
    if (!handle) return;

    // ── Mouse events ──
    const onMouseDown = (e: MouseEvent) => {
      // Only left-click, and only on the handle (not buttons inside it)
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;

      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        dragOffset.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      handlePointerMove(e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      handlePointerUp();
    };

    // ── Touch events ──
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;

      const touch = e.touches[0];
      isDragging.current = true;

      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        dragOffset.current = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      handlePointerMove(touch.clientX, touch.clientY);
    };

    const onTouchEnd = () => {
      handlePointerUp();
    };

    // Bind handle events
    handle.addEventListener("mousedown", onMouseDown);
    handle.addEventListener("touchstart", onTouchStart, { passive: false });

    // Bind document-level events (so dragging works even when cursor leaves handle)
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);

    // Set grab cursor on handle
    handle.style.cursor = "grab";

    return () => {
      handle.removeEventListener("mousedown", onMouseDown);
      handle.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      handle.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [enabled, handleRef, containerRef, handlePointerMove, handlePointerUp]);

  // Re-clamp on window resize
  useEffect(() => {
    if (!enabled || !position) return;
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const clamped = clamp(prev.x, prev.y);
        savePosition(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, position, clamp, savePosition]);

  // Reset position (e.g., double-click to snap back to default)
  const resetPosition = useCallback(() => {
    setPosition(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  // Build style object for the container
  const style: React.CSSProperties | undefined = position
    ? {
        top: position.y,
        left: position.x,
        bottom: "auto",
        right: "auto",
      }
    : undefined;

  return { style, isDragged: !!position, resetPosition };
}
