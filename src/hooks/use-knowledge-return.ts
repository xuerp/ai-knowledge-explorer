import { useRouterState } from "@tanstack/react-router";
import type { Entity } from "@/domain/types";
import { knowledgeReturnSearch, parseKnowledgeSearch } from "@/domain/knowledge-browse";

/** Keep both desktop and mobile Knowledge navigation in the current directory context. */
export function useKnowledgeReturn() {
  const { location, matches } = useRouterState({
    select: (state) => ({ location: state.location, matches: state.matches }),
  });
  const detail = matches.at(-1)?.loaderData as { entity?: Entity } | undefined;
  const entity = location.pathname.startsWith("/knowledge/") ? detail?.entity : undefined;
  const browse =
    "browse" in location.search && typeof location.search.browse === "string"
      ? location.search.browse
      : undefined;
  const search = entity
    ? knowledgeReturnSearch(entity.type, browse)
    : location.pathname === "/knowledge"
      ? parseKnowledgeSearch(location.search)
      : undefined;
  return { search, hash: entity?.id };
}
