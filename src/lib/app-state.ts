import { createContext, useContext } from "react";
import type { Lang, ReadingMode, Theme } from "@/domain/types";

export interface AppState {
  lang: Lang;
  mode: ReadingMode;
  theme: Theme;
  setLang: (lang: Lang) => void;
  setMode: (mode: ReadingMode) => void;
  setTheme: (theme: Theme) => void;
  t: (zh: string, en: string) => string;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("AppProvider missing");
  return context;
}

export const pick = <T>(value: { zh: T; en: T }, lang: Lang): T => value[lang];
