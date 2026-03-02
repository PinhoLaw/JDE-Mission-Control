"use client";

import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "@/providers/chat-provider";
import { cn } from "@/lib/utils";

export function ChatBubble() {
  const { isOpen, toggle, unreadCount } = useChat();

  return (
    <Button
      onClick={toggle}
      size="icon"
      className={cn(
        "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg transition-all duration-200 hover:scale-105",
        isOpen
          ? "bg-muted text-muted-foreground hover:bg-muted/80"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
      aria-label={isOpen ? "Close chat" : "Open chat"}
    >
      {isOpen ? (
        <X className="h-6 w-6" />
      ) : (
        <div className="relative">
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
      )}
    </Button>
  );
}
