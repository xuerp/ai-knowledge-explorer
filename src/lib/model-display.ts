import type { Entity, Lang } from "@/domain/types";

export function modelDisplayName(entity: Entity, lang: Lang) {
  const name = entity.name[lang];
  if (entity.type !== "model" || entity.familyId) return name;

  return lang === "zh" ? name.replace(/\s*系列$/u, "") : name.replace(/\s+family$/iu, "");
}

export function bilingualModelDisplayName(entity: Entity) {
  const zh = modelDisplayName(entity, "zh");
  const en = modelDisplayName(entity, "en");
  return zh.localeCompare(en, undefined, { sensitivity: "accent" }) === 0 ? zh : `${zh} ${en}`;
}
