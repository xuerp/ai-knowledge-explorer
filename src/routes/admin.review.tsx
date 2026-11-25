import { createFileRoute } from "@tanstack/react-router";
import { ReviewWorkspace } from "@/components/admin/review/ReviewWorkspace";

export const Route = createFileRoute("/admin/review")({
  head: () => ({
    meta: [{ title: "审核工作台 · AI Radar" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: ReviewWorkspace,
});
