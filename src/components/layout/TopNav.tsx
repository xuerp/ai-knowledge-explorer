import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Search,
  Moon,
  Sun,
  Languages,
  BookOpen,
  UserRound,
  Settings,
  BarChart3,
} from "lucide-react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { backNavigationFor } from "@/domain/back-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/", zh: "动态", en: "Updates" },
  { to: "/ask", zh: "决策助手", en: "Decide" },
  { to: "/knowledge", zh: "知识库", en: "Knowledge" },
] as const;

export function TopNav() {
  const { lang, setLang, theme, setTheme, t } = useApp();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const backNavigation = backNavigationFor(pathname, 0);

  const navigateBack = () => {
    const action = backNavigationFor(pathname, window.history.length).action;
    if (action === "history") {
      window.history.back();
      return;
    }
    void router.navigate({ to: "/" });
  };

  return (
    <header className="app-topnav sticky top-0 z-30 border-b border-border bg-card/95 text-foreground backdrop-blur">
      <div className="page-container flex h-[60px] items-center gap-3">
        {backNavigation.visible && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 shrink-0 gap-1.5 px-2 text-ink-soft hover:text-foreground"
            aria-label={t("返回上一页", "Back to previous page")}
            title={t("返回上一页", "Back to previous page")}
            onClick={navigateBack}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden lg:inline">{t("返回", "Back")}</span>
          </Button>
        )}

        <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="AI Radar">
          <span className="radar-mark text-signal" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-[-0.025em] text-foreground">
            AI Radar
          </span>
        </Link>

        <nav className="ml-5 hidden h-full items-center gap-0 md:flex">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "relative inline-flex h-full items-center whitespace-nowrap px-3 text-[13px] transition-colors " +
                  (active
                    ? "font-medium text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-signal"
                    : "text-ink-soft hover:text-foreground")
                }
              >
                {t(item.zh, item.en)}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <Link
          to="/knowledge"
          className="hidden h-8 w-52 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground hover:border-border-strong hover:text-foreground lg:flex xl:w-64"
        >
          <Search className="h-4 w-4" />
          <span>{t("搜索 模型 · Agent · 论文…", "Search models, agents, papers…")}</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            /
          </kbd>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          aria-label="Language"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
        >
          <Languages className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          aria-label="Theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("账户与设置", "Account and settings")}
            >
              <UserRound className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{t("个人空间", "Personal space")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account">
                <UserRound className="h-4 w-4" /> {t("账户", "Account")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="h-4 w-4" /> {t("设置", "Settings")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/following">
                <BookOpen className="h-4 w-4" /> {t("关注", "Following")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/quality">
                <BarChart3 className="h-4 w-4" /> {t("数据质量", "Data quality")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
