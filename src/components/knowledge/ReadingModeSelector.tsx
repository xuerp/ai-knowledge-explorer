import { READING_MODE_OPTIONS } from "@/domain/reading-mode";
import type { LocalizedText, ReadingMode } from "@/domain/types";
import { useApp } from "@/lib/app-state";

interface ReadingModeSelectorProps {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  context?: Partial<
    Record<ReadingMode, { description: LocalizedText; focusAreas: readonly LocalizedText[] }>
  >;
}

export function ReadingModeSelector({ value, onChange, context }: ReadingModeSelectorProps) {
  const { lang, t } = useApp();
  const activeOption =
    READING_MODE_OPTIONS.find((option) => option.id === value) ?? READING_MODE_OPTIONS[0];
  const activeContext = context?.[value] ?? activeOption;

  return (
    <div className="reading-mode-selector">
      <div
        className="reading-mode-tabs"
        role="group"
        aria-label={t("选择阅读视角", "Choose a reading lens")}
      >
        {READING_MODE_OPTIONS.map((option) => {
          const isActive = value === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={isActive}
              className={`reading-mode-button${isActive ? " is-active" : ""}`}
              title={(context?.[option.id] ?? option).description[lang]}
            >
              {option.shortLabel[lang]}
            </button>
          );
        })}
      </div>

      <div className="reading-mode-context" aria-live="polite">
        <p>{activeContext.description[lang]}</p>
        <div className="reading-mode-focus" aria-label={t("当前关注重点", "Current focus areas")}>
          {activeContext.focusAreas.map((area) => (
            <span key={area.en}>{area[lang]}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
