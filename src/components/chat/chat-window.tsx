// CRUZE UPGRADE — OMNISCIENT MODE
// Enhanced chat window with drag & drop file support, file previews, and memory indicator

"use client";

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import { useChat as useVercelChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@/providers/chat-provider";
import { useChatContext } from "./chat-context";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Rocket,
  Trash2,
  RefreshCw,
  AlertCircle,
  Paperclip,
  X,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDraggable } from "@/hooks/useDraggable";
import { validateFile, formatFileSize, type FileCategory } from "@/lib/cruze/file-analysis";

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

// ─── File attachment state ──────────────────────────────────────────────────
interface FileAttachment {
  file: File;
  category: FileCategory;
  preview?: string; // base64 preview for images
  uploading: boolean;
  uploaded: boolean;
  error?: string;
  // Server response data
  fileId?: string;
  analysis?: Record<string, unknown>;
  textContent?: string;
  base64Data?: string;
  mimeType?: string;
}

function getFileIcon(category: FileCategory) {
  switch (category) {
    case "csv":
    case "excel":
      return <FileSpreadsheet className="h-4 w-4" />;
    case "pdf":
      return <FileText className="h-4 w-4" />;
    case "image":
      return <ImageIcon className="h-4 w-4" />;
  }
}

export function ChatWindow() {
  const { isOpen, clearUnread } = useChat();
  const context = useChatContext();
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const lastSentRef = useRef<string>("");

  // CRUZE UPGRADE — Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachment, setAttachment] = useState<FileAttachment | null>(null);

  // ── Draggable ─────────────────────────────────────────────────────────────
  const { style: dragStyle, isDragged } = useDraggable({
    containerRef: panelRef,
    handleRef,
    enabled: isOpen,
  });

  // Keep a ref so the fetch wrapper always reads the latest context
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // Keep attachment ref for transport injection
  const attachmentRef = useRef<FileAttachment | null>(null);
  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "same-origin",
        fetch: async (url, init) => {
          try {
            if (init?.body && typeof init.body === "string") {
              const body = JSON.parse(init.body);
              body.context = contextRef.current;

              // CRUZE UPGRADE — Inject file attachment data
              const att = attachmentRef.current;
              if (att?.uploaded) {
                body.fileAttachment = {
                  fileId: att.fileId,
                  fileName: att.file.name,
                  fileType: att.category,
                  fileSize: att.file.size,
                  analysis: att.analysis,
                  textContent: att.textContent,
                  base64Data: att.base64Data,
                  mimeType: att.mimeType,
                };
              }

              init = { ...init, body: JSON.stringify(body) };
            }
          } catch (e) {
            console.error("[Cruze] Failed to inject context:", e);
          }
          const response = await globalThis.fetch(url, init);
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

  // Auto-scroll
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

  // ── CRUZE UPGRADE — File handling ─────────────────────────────────────────

  async function handleFileSelect(file: File) {
    const validation = validateFile(file);
    if (!validation.valid || !validation.category) {
      setLocalError(validation.error || "Unsupported file");
      return;
    }

    const newAttachment: FileAttachment = {
      file,
      category: validation.category,
      uploading: true,
      uploaded: false,
    };

    // Generate image preview
    if (validation.category === "image") {
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachment((prev) =>
          prev ? { ...prev, preview: e.target?.result as string } : prev,
        );
      };
      reader.readAsDataURL(file);
    }

    setAttachment(newAttachment);

    // Upload to server
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (context.eventId) formData.append("eventId", context.eventId);

      const response = await fetch("/api/chat/upload", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      const data = await response.json();

      setAttachment((prev) =>
        prev
          ? {
              ...prev,
              uploading: false,
              uploaded: true,
              fileId: data.fileId,
              analysis: data.analysis,
              textContent: data.textContent,
              base64Data: data.base64Data,
              mimeType: data.mimeType,
            }
          : prev,
      );
    } catch (err) {
      setAttachment((prev) =>
        prev
          ? {
              ...prev,
              uploading: false,
              error: err instanceof Error ? err.message : "Upload failed",
            }
          : prev,
      );
    }
  }

  function removeAttachment() {
    setAttachment(null);
  }

  // Drag & drop handlers
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only leave if we're actually leaving the panel
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsDragOver(false);
      }
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async function send(text: string) {
    if (!text.trim() || isLoading) return;

    // If we have an attachment that's still uploading, wait
    if (attachment?.uploading) {
      setLocalError("File is still uploading. Please wait...");
      return;
    }

    setInput("");
    setLocalError(null);
    clearError?.();
    lastSentRef.current = text;
    setRetryCount(0);

    try {
      await sendMessage({ text });
      // Clear attachment after sending
      setAttachment(null);
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
    setAttachment(null);
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
      ref={panelRef}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
        "animate-in slide-in-from-bottom-4 fade-in duration-200",
        "w-[520px] h-[calc(100vh-8rem)] max-h-[780px]",
        "max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:w-full max-sm:h-full max-sm:max-h-full max-sm:rounded-none",
        !isDragged && "bottom-24 right-6",
      )}
      style={dragStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── CRUZE UPGRADE — Drag overlay ──────────────────────── */}
      {isDragOver && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-background/90 backdrop-blur-sm border-2 border-dashed border-primary rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip className="h-10 w-10 animate-bounce" />
            <p className="text-sm font-medium">Drop file to analyze</p>
            <p className="text-xs text-muted-foreground">CSV, Excel, PDF, or Image</p>
          </div>
        </div>
      )}

      {/* ── Header (drag handle) ────────────────────────────── */}
      <div
        ref={handleRef}
        className="flex shrink-0 items-center justify-between border-b bg-muted/30 px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold leading-tight">Cruze</h3>
              {/* CRUZE UPGRADE — Memory indicator */}
              <div className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5" title="Memory active — I remember our conversations">
                <Brain className="h-3 w-3 text-primary" />
              </div>
            </div>
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
                I&apos;m Cruze — your Mission Control copilot. I know everything
                about your data, remember our conversations, and can analyze any
                file you drop in.
              </p>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {[
                "What's on this page?",
                "Break down today's numbers",
                "Spot check for issues",
                "Forecast this event",
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

        {/* Scroll anchor */}
        <div ref={scrollAnchorRef} className="h-px" />
      </div>

      {/* ── CRUZE UPGRADE — File attachment preview ──────────── */}
      {attachment && (
        <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              attachment.error ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
            )}>
              {attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt="preview"
                  className="h-8 w-8 rounded-lg object-cover"
                />
              ) : (
                getFileIcon(attachment.category)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{attachment.file.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {attachment.uploading
                  ? "Uploading..."
                  : attachment.error
                    ? attachment.error
                    : `${formatFileSize(attachment.file.size)} — Ready`}
              </p>
            </div>
            {attachment.uploading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={removeAttachment}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Input ───────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-end gap-2 border-t bg-muted/20 px-3 py-2.5"
      >
        {/* CRUZE UPGRADE — File attach button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file (CSV, Excel, PDF, Image)"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = ""; // reset for re-upload
          }}
        />

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            attachment
              ? "Ask about this file..."
              : "Ask anything... (Enter to send)"
          }
          className="min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || isLoading || (attachment?.uploading ?? false)}
          className="h-9 w-9 shrink-0 rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
