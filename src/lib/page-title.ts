import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useApp } from "@/lib/app-state";

/**
 * Browser-tab titles in the reader's language.
 *
 * Route `head` metadata is rendered on the server, before the stored language
 * preference is known, so it stays in Chinese for search and sharing. After
 * hydration the tab title follows the current language, mapped from the
 * Chinese route title.
 */
const SUFFIX = " · AI Radar";

const TITLES: Record<string, string> = {
  "AI Radar · 基于可信变化做出 AI 选择": "AI Radar · AI choices from trusted changes",
  "AI Radar · AI 模型与产品信息研究": "AI Radar · AI model and product research",
  账户: "Account",
  审核工作台: "Review workspace",
  只读审核后台: "Read-only review demo",
  用户管理: "User management",
  "AI 决策助手": "AI decision assistant",
  项目介绍: "Case study",
  模型对比: "Model comparison",
  关注: "Following",
  知识图谱: "Knowledge graph",
  知识库: "Knowledge base",
  兴趣初始化: "Set up interests",
  数据质量看板: "Data quality",
  研究记录: "Research record",
  设置: "Settings",
  公开研究页: "Public research",
  动态雷达: "Updates radar",
  未找到: "Not found",
  实体未找到: "Entity not found",
};

/** English tab title for a Chinese route title; unknown titles are kept as is. */
export function localizedTitle(title: string, lang: "zh" | "en"): string {
  if (lang === "zh") return title;
  if (title in TITLES) return TITLES[title];
  if (!title.endsWith(SUFFIX)) return title;
  const page = title.slice(0, -SUFFIX.length);
  // Entity and model pages put a product name first; names are not translated.
  return page in TITLES ? `${TITLES[page]}${SUFFIX}` : title;
}

/** Keeps the tab title in the current language across navigation and switches. */
export function LocalizedTitle() {
  const { lang } = useApp();
  // Re-run after every navigation, once the router has written the route title.
  const location = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    // The router may rewrite <title> after this effect; watch and re-apply.
    let source = document.title;
    const apply = () => {
      const next = localizedTitle(source, lang);
      if (document.title !== next) document.title = next;
    };
    apply();
    const element = document.querySelector("title");
    if (!element) return;
    const observer = new MutationObserver(() => {
      const current = document.title;
      if (current === localizedTitle(source, lang)) return;
      source = current;
      apply();
    });
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      // Leave the original title for the next language or route to translate.
      if (lang === "en") document.title = source;
    };
  }, [lang, location]);
  return null;
}
