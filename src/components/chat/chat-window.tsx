"use client";

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useChat as useVercelChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@/providers/chat-provider";
import { useChatContext } from "./chat-context";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Rocket, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ChatWindow() {
  const { isOpen, clearUnread } = useChat();
  const context = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

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
          if (init?.body && typeof init.body === "string") {
            const body = JSON.parse(init.body);
            body.context = contextRef.current;
            init = { ...init, body: JSON.stringify(body) };
          }
          return globalThis.fetch(url, init);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { messages, sendMessage, status, setMessages } = useVercelChat({
    transport,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus textarea when chat opens
  useEffect(() => {
    if (isOpen) {
      clearUnread();
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen, clearUnread]);

  // Send message
  async function send(text: string) {
    if (!text.trim() || isLoading) return;
    setInput("");
    await sendMessage({ text });
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
        "fixed bottom-24 right-6 z-50 flex w-[400px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
        "animate-in slide-in-from-bottom-4 fade-in duration-200",
        "max-h-[520px] h-[520px]",
        // Mobile responsive
        "max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:w-full max-sm:h-full max-sm:max-h-full max-sm:rounded-none",
      )}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold leading-tight">
              Cruze
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {isLoading ? "Thinking..." : "Online • ⌘/ to toggle"}
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

      {/* ── Messages ────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Rocket className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Good to see you, Mike.</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-[260px]">
                I&apos;m Cruze, your Mission Control Concierge. Ask me anything,
                request changes, or paste a screenshot.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {[
                "What's on this page?",
                "Show me today's numbers",
                "Help me improve this",
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
      </ScrollArea>

      {/* ── Input ───────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t bg-muted/20 px-3 py-2.5"
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything… (Enter to send)"
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
