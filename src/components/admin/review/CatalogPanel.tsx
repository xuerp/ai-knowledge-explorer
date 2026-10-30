import { Braces, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { ReviewViewModel } from "./review-view-model";
export function CatalogPanel({ context }: { context: ReviewViewModel }) {
  const {
    busy,
    catalogJson,
    catalogKind,
    catalogMessage,
    saveCatalogRecord,
    setCatalogJson,
    setTimelineEntityId,
    switchCatalogKind,
    timelineEntityId,
    user,
  } = context;
  return (
    <>
      {user.role === "admin" && (
        <section id="catalog-editor" className="scroll-mt-6 paper-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold">
                <Braces className="h-5 w-5 text-signal" />
                知识目录编辑器
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                新增或更新模型、应用、开发材料、评测和组织，并补充来源、时间线与关系。只有模型具体版本填写
                familyId 后，知识库、详情、图谱与版本对比会自动读取。
              </p>
            </div>
            <div className="flex rounded-md border border-border p-1">
              {(["entity", "relation", "timeline"] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={catalogKind === kind ? "default" : "ghost"}
                  onClick={() => switchCatalogKind(kind)}
                >
                  {kind === "entity" ? "实体 / 版本" : kind === "relation" ? "关系" : "时间线"}
                </Button>
              ))}
            </div>
          </div>
          {catalogKind === "timeline" && (
            <Input
              className="mt-4 max-w-md"
              aria-label="时间线所属实体 ID"
              placeholder="时间线所属实体 ID，例如 e-gpt"
              value={timelineEntityId}
              onChange={(event) => setTimelineEntityId(event.target.value)}
            />
          )}
          <Textarea
            className="mt-4 min-h-72 font-mono text-xs leading-relaxed"
            aria-label="目录 JSON"
            spellCheck={false}
            value={catalogJson}
            onChange={(event) => setCatalogJson(event.target.value)}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveCatalogRecord} disabled={busy}>
              <Check />
              校验并保存
            </Button>
            <span className="text-xs text-muted-foreground">
              相同 ID 会更新原记录；服务端会校验系列归属、端点和字段结构。
            </span>
          </div>
          {catalogMessage && <p className="mt-3 text-sm text-verified">{catalogMessage}</p>}
        </section>
      )}
    </>
  );
}
