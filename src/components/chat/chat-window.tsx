// CRUZE v2 — Production-grade chat window
// Beautiful message bubbles, streaming responses, drag-and-drop file UI,
// tool call visualization, suggested prompts, mobile responsive

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
import { ChatMessage, TypingIndicator, type MessagePart } from "./chat-message";
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
  Sparkles,
  ArrowDown,
  GripHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDraggable } from "@/hooks/useDraggable";
import {
  validateFile,
  formatFileSize,
  type FileCategory,
} from "@/lib/cruze/file-analysis";
import { motion, AnimatePresence } from "framer-motion";

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

const SUGGESTED_PROMPTS = [
  { label: "What's on this page?", icon: "👀" },
  { label: "Break down today's numbers", icon: "📊" },
  { label: "Spot check for issues", icon: "🔍" },
  { label: "Forecast this event", icon: "📈" },
  { label: "What should I improve?", icon: "💡" },
];

// ─── File attachment state ──────────────────────────────────────────────────
// CRUZE FILE ATTACHMENT — FINAL BULLETPROOF VERSION WITH SUPABASE STORAGE FALLBACK
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
  storageUrl?: string; // Supabase Storage fallback URL — durable even if base64Data is lost
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
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const lastSentRef = useRef<string>("");
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track attachment that was sent with each user message
  const [messageAttachments, setMessageAttachments] = useState<
    Map<string, { name: string; type: string }>
  >(new Map());

  // CRUZE UPGRADE — Drag & drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachment, _setAttachment] = useState<FileAttachment | null>(null);

  // CRUZE FILE RELIABILITY — MARCH 2026
  // Wrapper that updates BOTH React state AND the ref synchronously,
  // so the transport fetch() always sees the latest attachment data.
  const setAttachmentSafe = useCallback(
    (
      val:
        | FileAttachment
        | null
        | ((prev: FileAttachment | null) => FileAttachment | null),
    ) => {
      _setAttachment((prev) => {
        const next = typeof val === "function" ? val(prev) : val;
        attachmentRef.current = next;
        return next;
      });
    },
    [],
  );

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

  // CRUZE FILE RELIABILITY — MARCH 2026
  // Keep attachment ref for transport injection.
  // Updated SYNCHRONOUSLY in setAttachmentSafe() to avoid race conditions.
  const attachmentRef = useRef<FileAttachment | null>(null);

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
                // CRUZE FILE ATTACHMENT — FINAL BULLETPROOF VERSION WITH SUPABASE STORAGE FALLBACK
                body.fileAttachment = {
                  fileId: att.fileId,
                  fileName: att.file.name,
                  fileType: att.category,
                  fileSize: att.file.size,
                  analysis: att.analysis,
                  textContent: att.textContent,
                  base64Data: att.base64Data,
                  storageUrl: att.storageUrl, // Durable fallback — tiny string that survives state resets
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

  // Auto-scroll detection
  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
  }, []);

  // Auto-scroll
  const scrollToBottom = useCallback((smooth = true) => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "instant",
    });
  }, []);

  useEffect(() => {
    if (!showScrollButton) {
      scrollToBottom();
    }
  }, [messages, isLoading, localError, scrollToBottom, showScrollButton]);

  // Focus textarea when chat opens
  useEffect(() => {
    if (isOpen) {
      clearUnread();
      setTimeout(() => {
        textareaRef.current?.focus();
        scrollToBottom(false);
      }, 120);
    }
  }, [isOpen, clearUnread, scrollToBottom]);

  // ── CRUZE FILE RELIABILITY — MARCH 2026 ──────────────────────────────────
  // Handles file selection, upload with retry, and buffer validation.

  async function handleFileSelect(file: File) {
    const validation = validateFile(file);
    if (!validation.valid || !validation.category) {
      setLocalError(validation.error || "Unsupported file");
      return;
    }

    // Validate the file is actually readable (not a stale reference)
    if (file.size === 0) {
      setLocalError("File appears to be empty. Please try again.");
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
        setAttachmentSafe((prev) =>
          prev ? { ...prev, preview: e.target?.result as string } : prev,
        );
      };
      reader.readAsDataURL(file);
    }

    setAttachmentSafe(newAttachment);

    // Upload with retry — up to 2 attempts
    const MAX_UPLOAD_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      try {
        // Re-read the file each attempt to ensure a fresh ArrayBuffer
        const fileBytes = await file.arrayBuffer();
        if (fileBytes.byteLength === 0) {
          throw new Error(
            "File buffer is empty — the file may have been removed or is unreadable.",
          );
        }

        const freshBlob = new Blob([fileBytes], { type: file.type });
        const freshFile = new File([freshBlob], file.name, {
          type: file.type,
        });

        const formData = new FormData();
        formData.append("file", freshFile);
        if (context.eventId) formData.append("eventId", context.eventId);

        console.log(
          `[Cruze Upload] Attempt ${attempt}: uploading "${file.name}" (${file.size} bytes)`,
        );

        const response = await fetch("/api/chat/upload", {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        });

        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: "Upload failed" }));
          throw new Error(
            err.error || `Upload failed (HTTP ${response.status})`,
          );
        }

        const data = await response.json();

        // Validate the server returned actual data
        if (!data.success) {
          throw new Error(data.error || "Server returned unsuccessful response");
        }

        // For Excel files, verify base64Data was returned
        if (validation.category === "excel" && !data.base64Data) {
          console.warn(
            "[Cruze Upload] Server returned no base64Data for Excel file — retrying",
          );
          if (attempt < MAX_UPLOAD_ATTEMPTS) continue;
          throw new Error(
            "Server did not return file data. Please try dropping the file again.",
          );
        }

        console.log(
          `[Cruze Upload] Success: "${file.name}" uploaded (fileId: ${data.fileId}, base64: ${data.base64Data ? `${Math.round(data.base64Data.length / 1024)}KB` : "null"})`,
        );

        setAttachmentSafe((prev) =>
          prev
            ? {
                ...prev,
                uploading: false,
                uploaded: true,
                fileId: data.fileId,
                analysis: data.analysis,
                textContent: data.textContent,
                base64Data: data.base64Data,
                storageUrl: data.storageUrl,
                mimeType: data.mimeType,
              }
            : prev,
        );
        return; // Success — exit retry loop
      } catch (err) {
        console.error(`[Cruze Upload] Attempt ${attempt} failed:`, err);
        if (attempt >= MAX_UPLOAD_ATTEMPTS) {
          setAttachmentSafe((prev) =>
            prev
              ? {
                  ...prev,
                  uploading: false,
                  error:
                    err instanceof Error
                      ? err.message
                      : "Upload failed after retries",
                }
              : prev,
          );
        } else {
          // Wait before retry
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  function removeAttachment() {
    setAttachmentSafe(null);
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

    // CRUZE FILE RELIABILITY — MARCH 2026
    // If attachment has an error, warn but don't block (user can still chat)
    if (attachment?.error) {
      console.warn(
        "[Cruze] Sending with failed attachment:",
        attachment.error,
      );
    }

    // Verify the ref is in sync with state (defensive)
    if (attachment?.uploaded && !attachmentRef.current?.uploaded) {
      console.warn("[Cruze] attachmentRef out of sync — forcing sync");
      attachmentRef.current = attachment;
    }

    // Log what's being sent for debugging
    if (attachment?.uploaded) {
      console.log(
        `[Cruze] Sending message with attachment: "${attachment.file.name}" (base64: ${attachment.base64Data ? "present" : "MISSING"})`,
      );
    }

    setInput("");
    setLocalError(null);
    clearError?.();
    lastSentRef.current = text;
    setRetryCount(0);

    // Track the attachment for the message that's about to be sent
    if (attachment?.uploaded) {
      // We'll associate it with the next user message ID after it appears
      const attachInfo = {
        name: attachment.file.name,
        type: attachment.category,
      };
      // Use a small timeout to catch the new message ID
      setTimeout(() => {
        const lastUserMsg = messages.findLast((m) => m.role === "user");
        if (lastUserMsg) {
          setMessageAttachments((prev) => {
            const next = new Map(prev);
            next.set(lastUserMsg.id, attachInfo);
            return next;
          });
        }
      }, 100);
    }

    try {
      await sendMessage({ text });
      // Clear attachment after sending
      setAttachmentSafe(null);
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
    setAttachmentSafe(null);
    setMessageAttachments(new Map());
  }

  if (!isOpen) return null;

  // Extract text content from message parts (v6 UIMessage uses parts, not content)
  function getMessageText(m: (typeof messages)[number]): string {
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  // Extract parts for tool invocation display
  function getMessageParts(m: (typeof messages)[number]): MessagePart[] {
    return m.parts.map((p) => {
      if (p.type === "text") {
        return { type: "text" as const, text: (p as { type: "text"; text: string }).text };
      }
      // Handle tool-invocation parts (v6 uses `tool-${toolName}` types with flat structure)
      if (p.type.startsWith("tool-")) {
        const toolPart = p as unknown as Record<string, unknown>;
        return {
          type: "tool-invocation" as const,
          toolInvocation: {
            toolCallId: (toolPart.toolCallId as string) || "",
            toolName: p.type.replace(/^tool-/, ""),
            args: (toolPart.input as Record<string, unknown>) || {},
            state:
              (toolPart.state as string)?.includes("output") || (toolPart.state as string)?.includes("denied")
                ? ("result" as const)
                : (toolPart.state as string)?.includes("input")
                  ? ("call" as const)
                  : ("call" as const),
            result: toolPart.output ?? toolPart.errorText,
          },
        };
      }
      return { type: "text" as const, text: "" };
    });
  }

  const hasMessages = messages.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl",
            "w-[520px] h-[calc(100vh-8rem)] max-h-[780px]",
            "max-sm:bottom-0 max-sm:right-0 max-sm:left-0 max-sm:w-full max-sm:h-full max-sm:max-h-full max-sm:rounded-none",
            !isDragged && "bottom-24 right-6",
          )}
          style={dragStyle}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* ── Drag overlay ──────────────────────────────────── */}
          <AnimatePresence>
            {isDragOver && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[60] flex items-center justify-center bg-background/90 backdrop-blur-sm border-2 border-dashed border-primary rounded-2xl"
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="flex flex-col items-center gap-3 text-primary"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                    <Paperclip className="h-8 w-8" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold">Drop file to analyze</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      CSV, Excel, PDF, or Image
                    </p>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Header (drag handle) ────────────────────────────── */}
          <div
            ref={handleRef}
            className="flex shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-emerald-500/20 ring-1 ring-primary/10">
                <Rocket className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold leading-tight">
                    Cruze
                  </h3>
                  {/* Memory indicator */}
                  <div
                    className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5"
                    title="Memory active — I remember our conversations"
                  >
                    <Brain className="h-2.5 w-2.5 text-primary" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {localError ? (
                    <span className="text-destructive">Connection issue</span>
                  ) : isLoading ? (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Thinking...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Drag grip indicator */}
              <div className="hidden sm:flex text-muted-foreground/30">
                <GripHorizontal className="h-4 w-4" />
              </div>
              {hasMessages && (
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
          </div>

          {/* ── Messages (scrollable) ─────────────────────────── */}
          <div
            ref={scrollAreaRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 scroll-smooth"
          >
            {!hasMessages && !localError ? (
              /* ── Empty state ────────────────────────────────── */
              <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                  className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-emerald-500/15 ring-1 ring-primary/10"
                >
                  <Sparkles className="h-7 w-7 text-primary" />
                </motion.div>
                <motion.div
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.3 }}
                >
                  <p className="text-base font-semibold">
                    Good to see you, Mike.
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground max-w-[300px] leading-relaxed">
                    I&apos;m Cruze — your Mission Control copilot. I know
                    everything about your data, remember our conversations, and
                    can analyze any file you drop in.
                  </p>
                </motion.div>
                <motion.div
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.35, duration: 0.3 }}
                  className="mt-1 flex flex-wrap justify-center gap-1.5"
                >
                  {SUGGESTED_PROMPTS.map((q, i) => (
                    <motion.button
                      key={q.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 + i * 0.05 }}
                      className="rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:bg-muted hover:text-foreground hover:border-border hover:shadow-sm active:scale-95"
                      onClick={() => send(q.label)}
                    >
                      <span className="mr-1">{q.icon}</span>
                      {q.label}
                    </motion.button>
                  ))}
                </motion.div>
              </div>
            ) : (
              /* ── Message list ───────────────────────────────── */
              <div className="flex flex-col gap-4">
                {messages.map((m, idx) => {
                  const isLast = idx === messages.length - 1;
                  const isStreamingMsg =
                    isLast && m.role === "assistant" && status === "streaming";
                  const attachInfo = messageAttachments.get(m.id);

                  return (
                    <ChatMessage
                      key={m.id}
                      role={m.role as "user" | "assistant"}
                      content={getMessageText(m)}
                      parts={
                        m.role === "assistant"
                          ? getMessageParts(m)
                          : undefined
                      }
                      isStreaming={isStreamingMsg}
                      attachmentName={attachInfo?.name}
                      attachmentType={attachInfo?.type}
                    />
                  );
                })}
                {isLoading &&
                  messages[messages.length - 1]?.role !== "assistant" && (
                    <TypingIndicator />
                  )}
              </div>
            )}

            {/* ── Error Banner ──────────────────────────────────── */}
            <AnimatePresence>
              {localError && !isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5"
                >
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
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scroll anchor */}
            <div ref={scrollAnchorRef} className="h-px" />
          </div>

          {/* ── Scroll to bottom button ─────────────────────── */}
          <AnimatePresence>
            {showScrollButton && hasMessages && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute bottom-[140px] left-1/2 -translate-x-1/2 z-10"
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border-border/60"
                  onClick={() => scrollToBottom()}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── File attachment preview ──────────────────────── */}
          {/* CRUZE STANDARDIZED XLSX FULL IMPORT — MARCH 2026 */}
          <AnimatePresence>
            {attachment && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="shrink-0 border-t border-border/40 bg-muted/10 overflow-hidden"
              >
                <div className="px-3 py-2">
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border bg-background/80 px-3 py-2 transition-colors",
                      // Highlight import-ready XLSX files with emerald border
                      !!(attachment.analysis as Record<string, unknown>)
                        ?.importReady && "border-emerald-500/40 bg-emerald-500/5",
                      attachment.error && "border-destructive/30 bg-destructive/5",
                    )}
                  >
                    {/* File icon / preview */}
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                        attachment.error
                          ? "bg-destructive/10 text-destructive"
                          : attachment.analysis?.importReady
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-primary/10 text-primary",
                      )}
                    >
                      {attachment.preview ? (
                        <img
                          src={attachment.preview}
                          alt="preview"
                          className="h-9 w-9 rounded-lg object-cover"
                        />
                      ) : (
                        getFileIcon(attachment.category)
                      )}
                    </div>

                    {/* File info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {attachment.file.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {attachment.uploading
                          ? "Scanning file..."
                          : attachment.error
                            ? attachment.error
                            : attachment.analysis?.importReady
                              ? String(
                                  attachment.analysis.summary || "Import ready",
                                )
                              : `${formatFileSize(attachment.file.size)} — Ready`}
                      </p>
                    </div>

                    {/* Upload spinner */}
                    {attachment.uploading && (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
                    )}

                    {/* Remove button */}
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Input area ────────────────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="flex shrink-0 items-end gap-2 border-t border-border/40 bg-muted/10 px-3 py-2.5"
          >
            {/* File attach button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary transition-colors"
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
                attachment?.analysis?.importReady
                  ? 'Say "import this" to load into your event...'
                  : attachment
                    ? "Ask about this file..."
                    : "Ask Cruze anything..."
              }
              className="min-h-[40px] max-h-[120px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={
                !input.trim() ||
                isLoading ||
                (attachment?.uploading ?? false)
              }
              className={cn(
                "h-9 w-9 shrink-0 rounded-full transition-all",
                input.trim() && !isLoading
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/30"
                  : "",
              )}
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
