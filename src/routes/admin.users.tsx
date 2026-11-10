import { createFileRoute } from "@tanstack/react-router";
import { UsersWorkspace } from "@/components/admin/users/UsersWorkspace";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [{ title: "用户管理 · AI Radar" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: UsersWorkspace,
});
