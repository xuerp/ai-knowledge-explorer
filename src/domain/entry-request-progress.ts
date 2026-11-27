import type {
  EntryRequestAutoState,
  EntryRequestKind,
  EntryRequestView,
} from "@/services/entry-request-types";

export const entryRequestKindLabels: Record<EntryRequestKind, string> = {
  release: "新模型发现",
  verification: "核验请求",
  evidence: "补证请求",
  visitor: "访客提交",
};

export const entryRequestKindHints: Record<EntryRequestKind, string> = {
  release: "采集官方模型目录时发现的新型号",
  verification: "用户在决策结果里请求核验的“模型常识”",
  evidence: "决策助手发现候选缺少的资料",
  visitor: "访客在知识库提交的收录建议",
};

/** What the automation did, and whether a person needs to act. */
export function entryRequestProgress(row: EntryRequestView): {
  label: string;
  tone: "done" | "waiting" | "action" | "pending";
} {
  if (row.status === "resolved") return { label: "已收录", tone: "done" };
  if (row.status === "rejected") return { label: "不收录", tone: "done" };
  const state: EntryRequestAutoState | null = row.autoState;
  if (state === "candidates") {
    if (row.candidatesOpen > 0) {
      return { label: `已生成事实，待审核 ${row.candidatesOpen} 条`, tone: "waiting" };
    }
    // Facts that were merged or removed from the queue cannot close the request.
    return row.candidatesApproved + row.candidatesRejected > 0
      ? { label: "事实已审核，下一轮自动结束", tone: "waiting" }
      : { label: "生成的事实已不在队列里，需要人工确认", tone: "action" };
  }
  if (state === "no-evidence") return { label: "没找到新事实，需要人工确认", tone: "action" };
  if (state === "skipped") return { label: "无法自动处理，需要人工处理", tone: "action" };
  if (state === "failed") return { label: "自动处理失败，稍后重试", tone: "pending" };
  return { label: "等待自动处理", tone: "pending" };
}

/** The automation detail repeats the label for generated facts, so it is shown only otherwise. */
export function showsAutoDetail(row: EntryRequestView): boolean {
  return (
    Boolean(row.autoDetail) &&
    row.autoState !== "candidates" &&
    entryRequestProgress(row).tone !== "done"
  );
}

/** Verification requests without an official page carry an admin placeholder URL. */
export function hasOfficialPage(row: EntryRequestView): boolean {
  try {
    return new URL(row.sourceUrl).hostname !== "airadar.rainza.cn";
  } catch {
    return false;
  }
}

export function needsPerson(row: EntryRequestView): boolean {
  return entryRequestProgress(row).tone === "action";
}
