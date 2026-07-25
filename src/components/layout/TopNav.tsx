import { Link, useRouterState } from "@tanstack/react-router";
import { Radar, Search, Moon, Sun, Languages, BookOpen } from "lucide-react";
import { useApp } from "@/lib/app-context";
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
          ? "border-white/10 bg-graph-bg/85 text-white backdrop-blur"
          : "border-border bg-background/85 backdrop-blur")
      }
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <Radar className="h-5 w-5 text-signal" />
          <span className="font-serif text-lg font-semibold tracking-tight">AI Radar</span>
          <span className="chip hidden sm:inline-flex ml-1">Demo</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 ml-4">
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
                  "px-3 h-9 inline-flex items-center whitespace-nowrap rounded-md text-sm transition-colors " +
                  (active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-ink-soft hover:text-foreground hover:bg-accent/60")
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
          className="hidden xl:flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card text-sm text-muted-foreground hover:text-foreground w-72"
        >
          <Search className="h-4 w-4" />
          <span>{t("搜索 模型 · Agent · 论文…", "Search models, agents, papers…")}</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            /
          </kbd>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Reading mode">
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
          aria-label="Language"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
        >
          <Languages className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
