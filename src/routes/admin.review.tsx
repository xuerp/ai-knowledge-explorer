import { createFileRoute } from "@tanstack/react-router";
import { ReviewWorkspace } from "@/components/admin/review/ReviewWorkspace";

export const Route = createFileRoute("/admin/review")({
  head: () => ({
    meta: [
      { title: "Review workspace · AI Radar" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ReviewWorkspace,
});
