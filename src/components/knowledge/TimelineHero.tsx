import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { ConfidenceChip, SourceRow } from "@/components/common";
import type { TimelineEvent, Source } from "@/domain/types";
import { useApp } from "@/lib/app-state";

interface TimelineHeroProps {
  events: TimelineEvent[];
  sources: Source[];
  entityName: string;
}

export function TimelineHero({ events, sources, entityName }: TimelineHeroProps) {
  const { t, lang } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  if (events.length === 0) return null;

  // Sort events chronologically
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <section className="timeline-hero-section mb-8 rounded-xl border border-timeline-track bg-gradient-to-b from-timeline-track/30 to-transparent p-6">
      <div className="mb-6 flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-timeline-accent" />
        <h2 className="font-bold text-lg text-foreground">
          {t(`${entityName} 演进时间线`, `${entityName} Evolution Timeline`)}
        </h2>
        <span className="ml-auto font-mono text-xs tabular-nums text-temporal-slate">
          {sortedEvents.length} {t("个关键节点", "milestones")}
        </span>
      </div>

      {/* Timeline track */}
      <div className="relative">
        {/* Horizontal line */}
        <div className="absolute left-0 right-0 top-6 h-0.5 bg-timeline-track" />

        {/* Timeline nodes */}
        <div className="relative flex justify-between">
          {sortedEvents.map((event, index) => {
            const isExpanded = expandedId === event.id;
            const eventSources = event.sourceIds
              .map((id) => sourceById.get(id))
              .filter((s): s is Source => s !== undefined);

            return (
              <div
                key={event.id}
                className="timeline-node-wrapper flex-1"
                style={{ zIndex: sortedEvents.length - index }}
              >
                {/* Node marker */}
                <button
                  onClick={() => toggle(event.id)}
                  className="group relative mx-auto block"
                  aria-label={t("展开事件", "Expand event")}
                >
                  <div className="relative mx-auto h-12 w-12">
                    {/* Outer ring */}
                    <div
                      className={`absolute inset-0 rounded-full border-2 transition-all ${
                        isExpanded
                          ? "border-timeline-accent bg-timeline-accent scale-110"
                          : "border-timeline-accent/40 bg-background group-hover:border-timeline-accent group-hover:scale-105"
                      }`}
                    />
                    {/* Inner dot */}
                    <div
                      className={`absolute inset-3 rounded-full transition-colors ${
                        isExpanded
                          ? "bg-white"
                          : "bg-timeline-accent group-hover:bg-timeline-accent/80"
                      }`}
                    />
                  </div>

                  {/* Year label */}
                  <div className="mt-2 font-mono text-xs font-semibold tabular-nums text-temporal-slate">
                    {new Date(event.date).getFullYear()}
                  </div>
                </button>

                {/* Expanded card */}
                {isExpanded && (
                  <div className="timeline-event-card animate-in fade-in slide-in-from-top-2 duration-200 mt-4 rounded-lg border border-border bg-card p-4 shadow-lg">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{event.title[lang]}</h3>
                      <ConfidenceChip level={event.confidence} />
                    </div>

                    <time className="mb-2 block font-mono text-xs tabular-nums text-temporal-slate">
                      {event.date}
                    </time>

                    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                      {event.summary[lang]}
                    </p>

                    {eventSources.length > 0 && (
                      <div className="space-y-1 border-t border-border pt-2">
                        {eventSources.slice(0, 2).map((source) => (
                          <SourceRow key={source.id} source={source} />
                        ))}
                        {eventSources.length > 2 && (
                          <p className="text-xs text-muted-foreground">
                            +{eventSources.length - 2} {t("个来源", "more sources")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile timeline (vertical layout) */}
      <div className="mt-8 space-y-4 md:hidden">
        {sortedEvents.map((event) => {
          const eventSources = event.sourceIds
            .map((id) => sourceById.get(id))
            .filter((s): s is Source => s !== undefined);

          return (
            <div key={event.id} className="relative rounded-lg border border-border bg-card p-4">
              <div className="absolute -left-3 top-4 h-6 w-6 rounded-full border-2 border-timeline-accent bg-background">
                <div className="absolute inset-1 rounded-full bg-timeline-accent" />
              </div>

              <div className="ml-4">
                <div className="mb-1 flex items-center gap-2">
                  <time className="font-mono text-xs font-semibold tabular-nums text-temporal-slate">
                    {event.date}
                  </time>
                  <ConfidenceChip level={event.confidence} />
                </div>

                <h3 className="mb-2 text-sm font-semibold text-foreground">{event.title[lang]}</h3>

                <p className="text-xs leading-relaxed text-muted-foreground">
                  {event.summary[lang]}
                </p>

                {eventSources.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-border pt-2">
                    {eventSources.slice(0, 1).map((source) => (
                      <SourceRow key={source.id} source={source} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
