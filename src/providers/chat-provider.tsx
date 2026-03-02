"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

interface ChatContextValue {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  unreadCount: number;
  incrementUnread: () => void;
  clearUnread: () => void;
}

const ChatCtx = createContext<ChatContextValue>({
  isOpen: false,
  toggle: () => {},
  open: () => {},
  close: () => {},
  unreadCount: 0,
  incrementUnread: () => {},
  clearUnread: () => {},
});

export function useChat() {
  return useContext(ChatCtx);
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const toggle = useCallback(() => setIsOpen((o) => !o), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const incrementUnread = useCallback(
    () => setUnreadCount((c) => c + 1),
    [],
  );
  const clearUnread = useCallback(() => setUnreadCount(0), []);

  // ── Keyboard Shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+/ or Ctrl+/ → toggle chat
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggle();
      }

      // Escape → close chat
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        close();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, toggle, close]);

  return (
    <ChatCtx.Provider
      value={{
        isOpen,
        toggle,
        open,
        close,
        unreadCount,
        incrementUnread,
        clearUnread,
      }}
    >
      {children}
    </ChatCtx.Provider>
  );
}
