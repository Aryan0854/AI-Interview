"use client";

import React, { useEffect, useState, useRef } from "react";
import { useTheme, Theme } from "@/components/ThemeProvider";
import { Sun, Moon, Palette } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const themes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "blue", label: "Blue", icon: Palette },
  { id: "purple", label: "Purple", icon: Palette },
  { id: "emerald", label: "Emerald", icon: Palette },
  { id: "rose", label: "Rose", icon: Palette },
  { id: "sunset", label: "Sunset", icon: Palette },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Avoid hydration mismatch by waiting for mount
  useEffect(() => {
    setMounted(true);

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-xl border border-indigo-150/40 bg-white/20 dark:bg-slate-900/20 backdrop-blur-md opacity-0" />
    );
  }

  const activeTheme = themes.find((t) => t.id === theme) || themes[0];
  const ActiveIcon = activeTheme.icon;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        className="relative w-9 h-9 rounded-xl border border-primary/20 bg-background/60 backdrop-blur-md flex items-center justify-center text-primary hover:bg-primary/10 shadow-sm hover:shadow transition-all duration-300 overflow-hidden outline-none select-none group"
        aria-label="Select theme"
      >
        <ActiveIcon className="w-[18px] h-[18px] group-hover:scale-110 transition-transform duration-300" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 mt-2 w-36 rounded-xl border border-border bg-popover/90 backdrop-blur-md shadow-lg overflow-hidden z-50 p-1 flex flex-col gap-0.5"
          >
            {themes.map((t) => {
              const Icon = t.icon;
              const isActive = t.id === theme;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id as Theme);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-secondary"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
