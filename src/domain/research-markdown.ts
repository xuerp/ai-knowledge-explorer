import type { Claim, Evidence, Lang, ResearchAnswer } from "@/domain/types";

export function createMarkdown(
  answer: ResearchAnswer,
  claims: Claim[],
  sources: Evidence[],
  lang: Lang,
  dataMode: "demo" | "live" = "demo",
) {
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index + 1]));
  const lines = [
    `# ${answer.question[lang]}`,
    "",
    `> ${answer.summary[lang]}`,
    "",
    `Generated: ${answer.generatedAt}`,
    `Status: ${answer.status}`,
    "",
    "## Claims",
    "",
  ];
  claims.forEach((claim, index) => {
    const citations = claim.sourceIds
      .map((id) => sourceIndex.get(id))
      .filter(Boolean)
      .map((number) => `[${number}]`)
      .join(" ");
    lines.push(
      `### ${index + 1}. ${claim.confidence}`,
      "",
      `${claim.text[lang]} ${citations}`.trim(),
      "",
    );
  });
  lines.push("## Sources", "");
  sources.forEach((source, index) => {
    lines.push(
      `${index + 1}. [${source.title[lang]}](${source.url}) — ${source.publisher}, ${source.publishedAt || "Source date unavailable"}`,
    );
    if (source.sourceExcerpt?.trim()) {
      lines.push("", ...source.sourceExcerpt.split("\n").map((line) => `> ${line}`), "");
    } else {
      lines.push("", "Source excerpt unavailable.", "");
    }
  });
  lines.push(
    "",
    "---",
    dataMode === "demo"
      ? "Generated from an explicitly labelled AI Radar demo snapshot."
      : "Generated from cited AI Radar API research evidence.",
    "",
  );
  return lines.join("\n");
}
