import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang, ReadingMode, Theme } from "@/domain/types";
import { AppContext, type AppState } from "@/lib/app-state";

const PREFERENCES_STORAGE_KEY = "ai-radar.preferences.v1";

interface StoredPreferences {
  lang: Lang;
  mode: ReadingMode;
  theme: Theme;
}

const isLang = (value: unknown): value is Lang => value === "zh" || value === "en";
const isMode = (value: unknown): value is ReadingMode =>
  value === "general" || value === "product" || value === "technical";
const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

function parsePreferences(value: string | null): StoredPreferences | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredPreferences>;
    if (!isLang(parsed.lang) || !isMode(parsed.mode) || !isTheme(parsed.theme)) return null;
    return parsed as StoredPreferences;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("zh");
  const [mode, setMode] = useState<ReadingMode>("general");
  const [theme, setTheme] = useState<Theme>("light");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    const stored = parsePreferences(window.localStorage.getItem(PREFERENCES_STORAGE_KEY));
    if (stored) {
      setLang(stored.lang);
      setMode(stored.mode);
      setTheme(stored.theme);
    }
    setPreferencesLoaded(true);

    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== PREFERENCES_STORAGE_KEY) return;
      const next = parsePreferences(event.newValue);
      if (!next) return;
      setLang(next.lang);
      setMode(next.mode);
      setTheme(next.theme);
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ lang, mode, theme } satisfies StoredPreferences),
    );
  }, [lang, mode, theme, preferencesLoaded]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.documentElement.style.colorScheme = theme;
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
