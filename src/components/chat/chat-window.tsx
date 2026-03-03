"use client";

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useChat as useVercelChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@/providers/chat-provider";
import { useChatContext } from "./chat-context";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Rocket, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

export function ChatWindow() {
  const { isOpen, clearUnread } = useChat();
  const context = useChatContext();
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const lastSentRef = useRef<string>("");

  // Keep a ref so the fetch wrapper always reads the latest context
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
        fetch: async (url, init) => {
          // Inject fresh context into every request body
          try {
            if (init?.body && typeof init.body === "string") {
              const body = JSON.parse(init.body);
              body.context = contextRef.current;
              init = { ...init, body: JSON.stringify(body) };
            }
          } catch (e) {
            console.error("[Cruze] Failed to inject context:", e);
            // Proceed without context injection — still send the message
          }
          const response = await globalThis.fetch(url, init);
          // Surface server errors so the useChat hook picks them up
          if (!response.ok) {
            const text = await response.text().catch(() => "Unknown error");
            console.error(`[Cruze] API error ${response.status}:`, text);
            throw new Error(
              response.status === 401
                ? "Session expired. Please refresh the page."
                : response.status === 429
                  ? "Rate limited. Please wait a moment and try again."
                  : `Cruze encountered an error (${response.status}). Try again.`,
            );
          }
          return response;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } =
    useVercelChat({
      transport,
    });

  const isLoading = status === "submitted" || status === "streaming";

  // Surface useChat errors to local state
  useEffect(() => {
    if (error) {
      console.error("[Cruze] Chat error:", error);
      setLocalError(
        error.message || "Something went wrong. Please try again.",
      );
    }
  }, [error]);

  // Auto-scroll: use a scroll anchor at the bottom of messages
  const scrollToBottom = useCallback(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, localError, scrollToBottom]);

  // Focus textarea when chat opens
  useEffect(() => {
    if (isOpen) {
      clearUnread();
      setTimeout(() => {
        textareaRef.current?.focus();
        scrollToBottom();
      }, 120);
    }
  }, [isOpen, clearUnread, scrollToBottom]);

  // Send message with error handling and retry logic
  async function send(text: string) {
    if (!text.trim() || isLoading) return;
    setInput("");
    setLocalError(null);
    clearError?.();
    lastSentRef.current = text;
    setRetryCount(0);

    try {
      await sendMessage({ text });
    } catch (err) {
      console.error("[Cruze] sendMessage failed:", err);
      const msg =
        err instanceof Error ? err.message : "Failed to send message.";
      setLocalError(msg);
    }
  }

  // Retry last failed message
  async function handleRetry() {
    const text = lastSentRef.current;
    if (!text || retryCount >= MAX_RETRIES) return;

    setLocalError(null);
    clearError?.();
    setRetryCount((c) => c + 1);

    // Small delay before retry
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));

    try {
      await sendMessage({ text });
    } catch (err) {
      console.error("[Cruze] retry failed:", err);
      setLocalError(
        retryCount + 1 >= MAX_RETRIES
          ? "Cruze is having trouble right now. Please refresh the page and try again."
          : err instanceof Error
            ? err.message
            : "Retry failed. Please try again.",
      );
    }
  }

  // Dismiss error banner
  function dismissError() {
    setLocalError(null);
    clearError?.();
  }

  // Handle form submit
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  // Enter to send (Shift+Enter for newline)
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  // Clear conversation
  function handleClear() {
    setMessages([]);
    setLocalError(null);
    clearError?.();
    setRetryCount(0);
  }

  if (!isOpen) return null;

  // Extract text content from message parts (v6 UIMessage uses parts, not content)
  function getMessageText(m: (typeof messages)[number]): string {
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  return (
    <div
      className={cn(
        "fixed bottom-24 right-6 z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
        "animate-in slide-in-from-bottom-4 fade-in duration-200",
        // Larger window — fills more of the screen
        "w-[520px] h-[calc(100vh-8rem)] max-h-[780px]",
        // Mobile responsive
        "max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:w-full max-sm:h-full max-sm:max-h-full max-sm:rounded-none",
      )}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold leading-tight">Cruze</h3>
            <p className="text-[11px] text-muted-foreground">
              {localError
                ? "Connection issue"
                : isLoading
                  ? "Thinking..."
                  : "Online"}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            aria-label="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* ── Messages (scrollable) ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {messages.length === 0 && !localError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Good to see you, Mike.</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-[320px]">
                I&apos;m Cruze — your Mission Control copilot. Ask me about your
                data, get suggestions, or tell me what to improve.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {[
                "What's on this page?",
                "Break down today's numbers",
                "What should I improve?",
              ].map((q) => (
                <button
                  key={q}
                  className="rounded-full border bg-background px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                role={m.role as "user" | "assistant"}
                content={getMessageText(m)}
              />
            ))}
            {isLoading &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <TypingIndicator />
              )}
          </div>
        )}

        {/* ── Error Banner ──────────────────────────────────── */}
        {localError && !isLoading && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-xs text-destructive">{localError}</p>
              <div className="mt-1.5 flex items-center gap-2">
                {retryCount < MAX_RETRIES && lastSentRef.current && (
                  <button
                    onClick={handleRetry}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive underline-offset-2 hover:underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                )}
                <button
                  onClick={dismissError}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scroll anchor — always at the bottom of message list */}
        <div ref={scrollAnchorRef} className="h-px" />
      </div>

      {/* ── Input ───────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-end gap-2 border-t bg-muted/20 px-3 py-2.5"
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything... (Enter to send)"
          className="min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || isLoading}
          className="h-9 w-9 shrink-0 rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
