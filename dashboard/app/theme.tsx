"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

const ThemeContext = createContext({ mode: "dark" as "dark" | "light", toggle: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mofu-theme");
      // Apply the saved preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "light") setMode("light");
    } catch {}
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = mode; }, [mode]);
  function toggle() {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    try { localStorage.setItem("mofu-theme", next); } catch {}
  }
  return <ThemeContext.Provider value={{ mode, toggle }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return <button className="theme-toggle" onClick={toggle} aria-label={mode === "dark" ? "Use light theme" : "Use dark theme"}>{mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
