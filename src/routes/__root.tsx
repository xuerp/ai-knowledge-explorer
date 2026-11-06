import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isAssetLoadError, recoverStaleAssets } from "../lib/asset-recovery";
import { AppProvider } from "@/lib/app-context";
import { Toaster } from "@/components/ui/sonner";

// A new URL also refreshes the browser's favicon cache from the old template mark.
const iconVersion = "blue-radar-1859e8-20261106";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-serif text-7xl font-semibold text-foreground">404</div>
        <h2 className="mt-4 text-xl font-semibold text-foreground">页面未找到 · Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          你访问的实体或页面尚未收录到 AI Radar。
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-signal px-4 py-2 text-sm font-medium text-signal-foreground hover:opacity-90"
          >
            返回首页 Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const assetFailure = isAssetLoadError(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    recoverStaleAssets(error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">页面加载失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {assetFailure ? "页面资源加载失败，请刷新重试。" : "你可以刷新或返回首页。"}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              if (assetFailure) {
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {assetFailure ? "刷新页面" : "重试"}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AI Radar · 基于可信变化做出 AI 选择" },
      {
        name: "description",
        content: "AI Radar 整理已收录的模型与产品资料，用版本、关系与来源证据辅助研究和选择。",
      },
      { property: "og:title", content: "AI Radar · 基于可信变化做出 AI 选择" },
      {
        property: "og:description",
        content: "发现 AI 变化，理解可信依据，做出模型与产品选择。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#f7f8fa" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "AI Radar" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: `/brand/favicon.ico?v=${iconVersion}`,
        type: "image/x-icon",
        sizes: "16x16 32x32 48x48 256x256",
      },
      {
        rel: "icon",
        href: `/brand/radar.svg?v=${iconVersion}`,
        type: "image/svg+xml",
        sizes: "any",
      },
      { rel: "manifest", href: `/brand/manifest.webmanifest?v=${iconVersion}` },
      {
        rel: "apple-touch-icon",
        href: `/brand/apple-touch-icon.png?v=${iconVersion}`,
        sizes: "180x180",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <Outlet />
        <Toaster position="top-right" closeButton richColors />
      </AppProvider>
    </QueryClientProvider>
  );
}
