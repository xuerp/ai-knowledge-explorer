import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Diamond,
  Search,
  Moon,
  Sun,
  Languages,
  BookOpen,
  UserRound,
  Settings,
  BarChart3,
} from "lucide-react";
import { pick, useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { backNavigationFor } from "@/domain/back-navigation";
import { getReadingModeOption, READING_MODE_OPTIONS } from "@/domain/reading-mode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/", zh: "首页", en: "Home" },
  { to: "/knowledge", zh: "知识库", en: "Knowledge" },
  { to: "/compare", zh: "AI 对比", en: "Compare" },
  { to: "/graph", zh: "洞察", en: "Insights" },
  { to: "/ask", zh: "AI 研究", en: "Ask" },
  { to: "/quality", zh: "质量", en: "Quality" },
  { to: "/case-study", zh: "关于项目", en: "About" },
] as const;

export function TopNav() {
  const { lang, setLang, theme, setTheme, mode, setMode, t } = useApp();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const backNavigation = backNavigationFor(pathname, 0);
  const currentReadingMode = getReadingModeOption(mode);

  const navigateBack = () => {
    const action = backNavigationFor(pathname, window.history.length).action;
    if (action === "history") {
      window.history.back();
      return;
    }
    void router.navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 text-foreground backdrop-blur">
      <div className="page-container h-14 flex items-center gap-3">
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

        <Link to="/" className="flex items-center gap-2 shrink-0">
          <Diamond className="h-4 w-4 fill-signal text-signal" />
          <span className="text-base font-semibold tracking-tight text-signal">AI Radar</span>
        </Link>

        <nav className="hidden md:flex h-full items-center gap-1 ml-6">
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
                  "relative px-3 h-full inline-flex items-center whitespace-nowrap text-sm transition-colors " +
                  (active
                    ? "text-signal font-medium after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-signal"
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
          className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-background text-sm text-muted-foreground hover:text-foreground w-52 xl:w-64"
        >
          <Search className="h-4 w-4" />
          <span>{t("搜索 模型 · Agent · 论文…", "Search models, agents, papers…")}</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            /
          </kbd>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="hidden gap-2 px-2.5 lg:inline-flex"
              aria-label={t(
                `阅读模式：${currentReadingMode.shortLabel.zh}`,
                `Reading mode: ${currentReadingMode.shortLabel.en}`,
              )}
            >
              <BookOpen className="h-4 w-4" />
              <span>{pick(currentReadingMode.shortLabel, lang)}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>{t("阅读模式", "Reading mode")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              {READING_MODE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  className="items-start py-2.5"
                >
                  <span>
                    <span className="block text-sm font-medium">{pick(option.label, lang)}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {pick(option.description, lang)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

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
