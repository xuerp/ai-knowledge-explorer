import { BookOpen, Briefcase, Code2 } from "lucide-react";
import { READING_MODE_OPTIONS } from "@/domain/reading-mode";
import type { ReadingMode } from "@/domain/types";
import { useApp } from "@/lib/app-state";

interface ReadingModeSelectorProps {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
}

const MODE_ICONS = {
  general: BookOpen,
  product: Briefcase,
  technical: Code2,
} as const;

export function ReadingModeSelector({ value, onChange }: ReadingModeSelectorProps) {
  const { lang } = useApp();

  return (
    <div className="reading-mode-selector">
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
        {READING_MODE_OPTIONS.map((option) => {
          const Icon = MODE_ICONS[option.id];
          const isActive = value === option.id;

          return (
            <button
              key={option.id}
              onClick={() => onChange(option.id)}
              className={`reading-mode-button group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "bg-timeline-accent text-white shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={option.description[lang]}
            >
              <Icon
                className={`h-4 w-4 transition-transform ${isActive ? "scale-110" : "group-hover:scale-105"}`}
              />
              <span>{option.shortLabel[lang]}</span>

              {/* Active indicator line */}
              {isActive && (
                <div className="absolute -bottom-1 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-white animate-in fade-in slide-in-from-bottom-1 duration-200" />
              )}
            </button>
          );
        })}
      </div>

      {/* Active mode description */}
      <p className="mt-2 text-xs text-muted-foreground animate-in fade-in duration-300">
        {READING_MODE_OPTIONS.find((opt) => opt.id === value)?.description[lang]}
      </p>
    </div>
  );
}
