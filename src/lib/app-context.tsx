import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang, ReadingMode, Theme } from "./demo-data";

interface AppState {
  lang: Lang;
  mode: ReadingMode;
  theme: Theme;
  setLang: (l: Lang) => void;
  setMode: (m: ReadingMode) => void;
  setTheme: (t: Theme) => void;
  t: (zh: string, en: string) => string;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("zh");
  const [mode, setMode] = useState<ReadingMode>("general");
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [theme, lang]);

  const value = useMemo<AppState>(
    () => ({
      lang,
      mode,
      theme,
      setLang,
      setMode,
      setTheme,
      t: (zh, en) => (lang === "zh" ? zh : en),
    }),
    [lang, mode, theme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider missing");
  return ctx;
}

export const pick = <T,>(obj: { zh: T; en: T }, lang: Lang): T => obj[lang];
