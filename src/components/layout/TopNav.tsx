import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Github,
  Moon,
  Sun,
  Languages,
  Menu,
  BookOpen,
  UserRound,
  Settings,
  BarChart3,
  Info,
} from "lucide-react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { backNavigationFor } from "@/domain/back-navigation";
import { useKnowledgeReturn } from "@/hooks/use-knowledge-return";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/updates", zh: "动态", en: "Updates" },
  { to: "/knowledge", zh: "知识库", en: "Knowledge" },
  { to: "/ask", zh: "决策助手", en: "Decide" },
  { to: "/graph", zh: "知识图谱", en: "Graph" },
] as const;

export function TopNav({ variant = "product" }: { variant?: "product" | "showcase" }) {
  const { lang, setLang, theme, setTheme, t } = useApp();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const knowledgeReturn = useKnowledgeReturn();
  const showcase = variant === "showcase";
  const backNavigation = backNavigationFor(pathname, 0);
  const toggleLanguage = () => setLang(lang === "zh" ? "en" : "zh");
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const navigateBack = () => {
    const action = backNavigationFor(pathname, window.history.length).action;
    if (action === "history") {
      window.history.back();
      return;
    }
    void router.navigate({ to: "/" });
  };

  const links = showcase ? (
    <>
      <Link to="/updates">{t("产品体验", "Product")}</Link>
      <a href="#features">{t("功能概览", "Features")}</a>
      <Link to="/case-study">{t("项目介绍", "About the project")}</Link>
    </>
  ) : (
    NAV.map((item) => {
      const active = pathname === item.to || pathname.startsWith(item.to + "/");
      return (
        <Link
          key={item.to}
          to={item.to}
          search={item.to === "/knowledge" ? knowledgeReturn.search : undefined}
          hash={item.to === "/knowledge" ? knowledgeReturn.hash : undefined}
          aria-current={active ? "page" : undefined}
        >
          {t(item.zh, item.en)}
        </Link>
      );
    })
  );

  return (
    <header
      className={`site-header app-topnav${showcase ? " is-showcase" : ""}${backNavigation.visible ? " has-back" : ""}`}
    >
      <div className="site-header__inner">
        {backNavigation.visible && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("返回上一页", "Back to previous page")}
            title={t("返回上一页", "Back to previous page")}
            onClick={navigateBack}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        <Link to="/" className="site-header__logo" aria-label={t("AI Radar 首页", "AI Radar home")}>
          <span className="radar-mark" aria-hidden="true" />
          AI Radar
        </Link>
        <nav className="site-header__desktop-nav" aria-label={t("主导航", "Main navigation")}>
          {links}
        </nav>
        <div className="site-header__actions">
          {!showcase && (
            <Link to="/case-study" className="site-header__about">
              {t("项目介绍", "About")}
            </Link>
          )}
          <a
            href="https://github.com/xuerp/ai-knowledge-explorer"
            className="site-header__icon site-header__github"
            aria-label={t("GitHub 源码", "GitHub source")}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github aria-hidden="true" />
          </a>
          <button
            type="button"
            className="site-header__preference"
            aria-label={t("切换语言", "Switch language")}
            title={t("切换语言", "Switch language")}
            onClick={toggleLanguage}
          >
            <Languages aria-hidden="true" />
          </button>
          <button
            type="button"
            className="site-header__preference"
            aria-label={t("切换主题", "Switch theme")}
            title={t("切换主题", "Switch theme")}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          {showcase ? (
            <details className="site-header__mobile-menu">
              <summary aria-label={t("展开导航", "Open navigation")}>
                <Menu aria-hidden="true" />
              </summary>
              <nav
                aria-label={t("手机导航", "Mobile navigation")}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a"))
                    event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                {links}
                <a
                  href="https://github.com/xuerp/ai-knowledge-explorer"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("GitHub 源码", "GitHub source")}
                </a>
              </nav>
            </details>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("账户与设置", "Account and settings")}
                >
                  <UserRound aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t("个人空间", "Personal space")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account">
                    <UserRound aria-hidden="true" />
                    {t("账户", "Account")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <Settings aria-hidden="true" />
                    {t("设置", "Settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/following">
                    <BookOpen aria-hidden="true" />
                    {t("关注", "Following")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quality">
                    <BarChart3 aria-hidden="true" />
                    {t("数据质量", "Data quality")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/case-study">
                    <Info aria-hidden="true" />
                    {t("项目介绍", "About the project")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={toggleLanguage}>
                  <Languages aria-hidden="true" />
                  {t("切换至 English", "Switch to 中文")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTheme}>
                  {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                  {theme === "dark" ? t("浅色主题", "Light theme") : t("深色主题", "Dark theme")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
