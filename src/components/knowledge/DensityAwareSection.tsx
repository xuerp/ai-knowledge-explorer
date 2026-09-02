import type { ReactNode } from "react";
import { Focus, Paperclip, EyeOff } from "lucide-react";
import type { SectionDensity } from "@/domain/reading-mode";

interface DensityAwareSectionProps {
  density: SectionDensity;
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}

const DENSITY_ICONS = {
  focus: Focus,
  supporting: Paperclip,
  hidden: EyeOff,
} as const;

const DENSITY_LABELS = {
  focus: { zh: "重点", en: "Focus" },
  supporting: { zh: "补充", en: "Supporting" },
  hidden: { zh: "隐藏", en: "Hidden" },
} as const;

export function DensityAwareSection({
  density,
  title,
  children,
  defaultExpanded = true,
}: DensityAwareSectionProps) {
  if (density === "hidden") {
    return null; // Hidden sections are not rendered in the DOM
  }

  const Icon = DENSITY_ICONS[density];
  const isFocus = density === "focus";

  return (
    <section
      className={`density-section animate-in fade-in slide-in-from-bottom-2 duration-300 ${
        isFocus
          ? "focus-section mb-8 rounded-xl border-2 border-timeline-accent/20 bg-gradient-to-br from-background to-timeline-track/10 p-6 shadow-md"
          : "supporting-section mb-6 rounded-lg border border-border bg-card p-4"
      }`}
    >
      <div className="mb-4 flex items-center gap-2">
        <Icon
          className={`h-5 w-5 ${
            isFocus ? "text-timeline-accent" : "text-muted-foreground"
          }`}
        />
        <h2
          className={`${
            isFocus ? "font-bold text-xl" : "font-semibold text-base"
          } text-foreground`}
        >
          {title}
        </h2>
        <span
          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
            isFocus
              ? "bg-timeline-accent/10 text-timeline-accent"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {DENSITY_LABELS[density].zh}
        </span>
      </div>

      <div className={isFocus ? "space-y-4" : "space-y-2"}>{children}</div>
    </section>
  );
}
