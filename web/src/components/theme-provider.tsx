"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "dark" | "light";
  setTheme: (t: Theme) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolved: "dark",
  setTheme: () => {},
  cycleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("serviceos-theme") as Theme | null;
    const t = saved && ["dark", "light", "system"].includes(saved) ? saved : "dark";
    setThemeState(t);
    setResolved(resolveTheme(t));
  }, []);

  // Apply theme to <html>
  useEffect(() => {
    const r = resolveTheme(theme);
    setResolved(r);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(r);
    document.documentElement.setAttribute("data-theme", r);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("serviceos-theme", t);
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
