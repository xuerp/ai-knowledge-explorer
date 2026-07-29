import { Link, useRouterState } from "@tanstack/react-router";
import { Diamond, Search, Moon, Sun, Languages, BookOpen, UserRound, Settings } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
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
  { to: "/graph", zh: "图谱", en: "Graph" },
  { to: "/ask", zh: "AI 研究", en: "Ask" },
  { to: "/following", zh: "关注", en: "Following" },
] as const;

export function TopNav({ dark = false }: { dark?: boolean }) {
  const { lang, setLang, theme, setTheme, mode, setMode, t } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header
      className={
        "sticky top-0 z-30 border-b " +
        (dark
          ? "border-white/10 bg-graph-bg/92 text-white backdrop-blur"
          : "border-border bg-white/95 backdrop-blur")
      }
    >
      <div className="page-container h-14 flex items-center gap-3">
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
              size="icon"
              className="hidden sm:inline-flex"
              aria-label="Reading mode"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{t("阅读模式", "Reading mode")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <DropdownMenuRadioItem value="general">{t("通俗", "General")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="product">{t("产品", "Product")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="technical">
                {t("技术", "Technical")}
              </DropdownMenuRadioItem>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
