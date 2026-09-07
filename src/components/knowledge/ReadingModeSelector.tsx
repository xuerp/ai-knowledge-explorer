import { READING_MODE_OPTIONS } from "@/domain/reading-mode";
import type { ReadingMode } from "@/domain/types";
import { useApp } from "@/lib/app-state";

interface ReadingModeSelectorProps {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
}

export function ReadingModeSelector({ value, onChange }: ReadingModeSelectorProps) {
  const { lang } = useApp();
  const activeOption =
    READING_MODE_OPTIONS.find((option) => option.id === value) ?? READING_MODE_OPTIONS[0];

  return (
    <div className="reading-mode-selector min-w-0">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg border border-border bg-card p-1 shadow-sm">
        {READING_MODE_OPTIONS.map((option) => {
          const isActive = value === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={isActive}
              className={`reading-mode-button group relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-timeline-accent text-white shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={option.description[lang]}
            >
              <span>{option.shortLabel[lang]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 animate-in fade-in duration-300" aria-live="polite">
        <p className="text-xs text-muted-foreground">{activeOption.description[lang]}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {activeOption.focusAreas.map((area) => (
            <span
              key={area.en}
              className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground"
            >
              {area[lang]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
