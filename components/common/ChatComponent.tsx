"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, X, MessageCircle, GripHorizontal } from "lucide-react";
import MDEditor from "@uiw/react-md-editor";
import { BRAND } from "@/lib/config/brand";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: string;
}

/** Position and size of the open chat window, in CSS pixels from the top-left of the viewport. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

type DragMode = "move" | "resize-br" | "resize-tl";

const RECT_KEY = "trackbot-chat-rect";
const LAUNCHER_KEY = "trackbot-chat-launcher";
const LAUNCHER_SIZE = 64;
const MIN_W = 280;
const MIN_H = 340;
const EDGE = 8; // keep this much of the window on screen on every side

const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight });

/** Keep the window inside the screen and within its minimum and maximum size. */
function clampRect(r: Rect): Rect {
  const { vw, vh } = viewport();
  const w = Math.min(Math.max(r.w, Math.min(MIN_W, vw - EDGE * 2)), vw - EDGE * 2);
  const h = Math.min(Math.max(r.h, Math.min(MIN_H, vh - EDGE * 2)), vh - EDGE * 2);
  const x = Math.min(Math.max(r.x, EDGE), vw - w - EDGE);
  const y = Math.min(Math.max(r.y, EDGE), vh - h - EDGE);
  return { x, y, w, h };
}

function clampLauncherPosition(point: Point): Point {
  const { vw, vh } = viewport();
  return {
    x: Math.min(Math.max(point.x, EDGE), Math.max(EDGE, vw - LAUNCHER_SIZE - EDGE)),
    y: Math.min(Math.max(point.y, EDGE), Math.max(EDGE, vh - LAUNCHER_SIZE - EDGE)),
  };
}

function defaultLauncherPosition(): Point {
  const { vw, vh } = viewport();
  return clampLauncherPosition({
    x: vw - LAUNCHER_SIZE - 16,
    y: vh - LAUNCHER_SIZE - 16,
  });
}

function loadLauncherPosition(): Point {
  try {
    const raw = window.localStorage.getItem(LAUNCHER_KEY);
    if (raw) {
      const point = JSON.parse(raw) as Point;
      if ([point.x, point.y].every(Number.isFinite)) {
        return clampLauncherPosition(point);
      }
    }
  } catch {
    // The default position is fine when storage is unavailable.
  }
  return defaultLauncherPosition();
}

/** Bottom-right corner, like the original floating chat. */
function defaultRect(): Rect {
  const { vw, vh } = viewport();
  const w = Math.min(420, vw - 32);
  const h = Math.min(600, vh - 32);
  return clampRect({ w, h, x: vw - w - 16, y: vh - h - 16 });
}

function loadRect(): Rect {
  try {
    const raw = window.localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Rect;
      if ([r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n))) return clampRect(r);
    }
  } catch {
    // Storage can be blocked (private window); the default position is fine.
  }
  return defaultRect();
}

const nowLabel = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const ChatComponent: React.FC = () => {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [launcherPosition, setLauncherPosition] = useState<Point | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const drag = useRef<{ mode: DragMode; px: number; py: number; start: Rect } | null>(null);
  const launcherDrag = useRef<{
    pointerId: number;
    px: number;
    py: number;
    start: Point;
    moved: boolean;
  } | null>(null);
  const suppressLauncherClick = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setLauncherPosition(loadLauncherPosition());
  }, []);

  const open = () => {
    setRect((current) => current ?? loadRect());
    setIsOpen(true);
  };

  // Keep the window on screen when the browser window or phone orientation changes.
  useEffect(() => {
    const onResize = () => setRect((r) => (r ? clampRect(r) : r));
    const onLauncherResize = () =>
      setLauncherPosition((point) => (point ? clampLauncherPosition(point) : point));
    window.addEventListener("resize", onResize);
    window.addEventListener("resize", onLauncherResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onLauncherResize);
    };
  }, []);

  const saveRect = useCallback((r: Rect) => {
    try {
      window.localStorage.setItem(RECT_KEY, JSON.stringify(r));
    } catch {
      // Not saving the position is harmless.
    }
  }, []);

  const saveLauncherPosition = useCallback((point: Point) => {
    try {
      window.localStorage.setItem(LAUNCHER_KEY, JSON.stringify(point));
    } catch {
      // Not saving the launcher position is harmless.
    }
  }, []);

  const startLauncherDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const start = launcherPosition ?? { x: bounds.left, y: bounds.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    launcherDrag.current = {
      pointerId: e.pointerId,
      px: e.clientX,
      py: e.clientY,
      start,
      moved: false,
    };
  };

  const moveLauncher = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = launcherDrag.current;
    if (!current || current.pointerId !== e.pointerId) return;

    const dx = e.clientX - current.px;
    const dy = e.clientY - current.py;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) current.moved = true;
    if (current.moved) {
      setLauncherPosition(
        clampLauncherPosition({ x: current.start.x + dx, y: current.start.y + dy })
      );
    }
  };

  const endLauncherDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = launcherDrag.current;
    if (!current || current.pointerId !== e.pointerId) return;

    launcherDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!current.moved) return;

    const point = clampLauncherPosition({
      x: current.start.x + e.clientX - current.px,
      y: current.start.y + e.clientY - current.py,
    });
    setLauncherPosition(point);
    saveLauncherPosition(point);
    suppressLauncherClick.current = true;
  };

  const startDrag = (mode: DragMode) => (e: React.PointerEvent<HTMLElement>) => {
    if (!rect) return;
    // The close button inside the header is a button, not a drag handle.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
  };

  const onDrag = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    const { start } = d;
    const { vw, vh } = viewport();

    if (d.mode === "move") {
      setRect(clampRect({ ...start, x: start.x + dx, y: start.y + dy }));
    } else if (d.mode === "resize-br") {
      const w = Math.min(Math.max(start.w + dx, MIN_W), vw - EDGE - start.x);
      const h = Math.min(Math.max(start.h + dy, MIN_H), vh - EDGE - start.y);
      setRect({ ...start, w, h });
    } else {
      // Top-left handle: the opposite (bottom-right) corner stays where it is.
      const w = Math.min(Math.max(start.w - dx, MIN_W), start.x + start.w - EDGE);
      const h = Math.min(Math.max(start.h - dy, MIN_H), start.y + start.h - EDGE);
      setRect({ x: start.x + start.w - w, y: start.y + start.h - h, w, h });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setRect((r) => {
      if (r) saveRect(r);
      return r;
    });
  };

  const resetPosition = () => {
    const r = defaultRect();
    setRect(r);
    saveRect(r);
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: "user",
      timestamp: nowLabel(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Send the last few turns so the bot can follow the conversation.
      const history = messages.slice(-8).map((m) => ({
        role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `locale` is the language chosen in the switcher, so the assistant answers in it.
        body: JSON.stringify({ message: userMessage.text, history, locale }),
      });

      if (response.status === 429) {
        throw new Error("rate-limited");
      }
      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data: { reply?: string } = await response.json();
      if (!data.reply) {
        throw new Error("No valid message content received");
      }

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), text: data.reply as string, sender: "bot", timestamp: nowLabel() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: t("Oops, something went wrong. Please try again."),
          sender: "bot",
          timestamp: nowLabel(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="font-satoshi">
      <AnimatePresence>
        {isOpen && rect ? (
          <motion.div
            key="chat-window"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            style={{ position: "fixed", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            className="z-50 bg-white rounded-lg shadow-xl flex flex-col overflow-hidden border border-gray-200"
            data-color-mode="light"
          >
            <div
              className="bg-black text-white px-4 py-3 flex justify-between items-center cursor-move select-none touch-none"
              onPointerDown={startDrag("move")}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={resetPosition}
              title={t("Drag to move. Double-click to reset.")}
            >
              <div className="flex items-center gap-2 min-w-0">
                <GripHorizontal size={20} className="text-gray-400 shrink-0" aria-hidden />
                <h3 className="text-lg font-medium truncate">
                  <T>Chat with</T> {BRAND.assistantName}
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-300 hover:text-white"
                aria-label={t("Close chat")}
              >
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
              {messages.length === 0 ? (
                <div className="text-gray-500 text-center">
                  <T>Start a conversation!</T>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`mb-4 flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] p-3 rounded-lg ${
                        msg.sender === "user" ? "bg-black text-white" : "bg-gray-200 text-gray-800"
                      }`}
                    >
                      {msg.sender === "bot" ? (
                        <MDEditor.Markdown
                          source={msg.text}
                          className="markdown-body text-base"
                          style={{
                            background: "transparent",
                            color: "#1f2a44",
                            fontFamily: "Satoshi, sans-serif",
                          }}
                        />
                      ) : (
                        <p className="text-base">{msg.text}</p>
                      )}
                      <span className="text-xs text-gray-400 block mt-2">{msg.timestamp}</span>
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="text-gray-500 text-sm">
                  {BRAND.assistantName} <T>is typing…</T>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-4 bg-white border-t border-gray-200">
              <div className="flex items-center gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={t("Type your message...")}
                  className="flex-1 p-3 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-black"
                  rows={2}
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  aria-label={t("Send")}
                  className="p-3 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                >
                  <Send size={22} />
                </button>
              </div>
            </div>

            {/* Resize handles: top-left grows the window up and left, bottom-right down and right. */}
            <div
              className="absolute left-0 top-0 h-5 w-5 cursor-nwse-resize touch-none"
              onPointerDown={startDrag("resize-tl")}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="separator"
              aria-label={t("Resize chat")}
            />
            <div
              className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none"
              onPointerDown={startDrag("resize-br")}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="separator"
              aria-label={t("Resize chat")}
            >
              <svg viewBox="0 0 20 20" className="h-full w-full text-gray-400" aria-hidden>
                <path d="M6 18 L18 6 M11 18 L18 11 M16 18 L18 16" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="chat-bubble"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onPointerDown={startLauncherDrag}
            onPointerMove={moveLauncher}
            onPointerUp={endLauncherDrag}
            onPointerCancel={endLauncherDrag}
            onClick={() => {
              if (suppressLauncherClick.current) {
                suppressLauncherClick.current = false;
                return;
              }
              open();
            }}
            aria-label={t("Open chat")}
            title={t("Drag to move or click to open chat")}
            style={
              launcherPosition
                ? { position: "fixed", left: launcherPosition.x, top: launcherPosition.y }
                : undefined
            }
            className={`${
              launcherPosition ? "" : "fixed bottom-4 right-4"
            } z-50 w-16 h-16 bg-black text-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-800 cursor-grab active:cursor-grabbing touch-none`}
          >
            <MessageCircle size={32} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatComponent;
