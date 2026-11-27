import type { ChangeContext } from "@/domain/change-context";
import type { ChangeEvent, Entity, ModelAccessChannelType } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { modelDisplayName } from "@/lib/model-display";

const channelLabels: Record<ModelAccessChannelType, [string, string]> = {
  "official-api": ["官方 API", "Official API"],
  "first-party-product": ["官方产品", "First-party product"],
  "managed-cloud": ["云平台", "Managed cloud"],
  "open-weights": ["开放权重", "Open weights"],
  "restricted-access": ["受限访问", "Restricted access"],
};

/** Reviewed context for the selected change: lineup, access, predecessor, related. */
export function ChangeContextDetails({
  context,
  entityById,
  kindLabel,
  onSelectChange,
}: {
  context: ChangeContext;
  entityById: Map<string, Entity>;
  kindLabel: (kind: ChangeEvent["kind"]) => string;
  onSelectChange: (id: string) => void;
}) {
  const { t, lang } = useApp();
  const { lineup, access, previous, related } = context;
  if (!lineup && access.length === 0 && !previous && related.length === 0) return null;
  return (
    <dl className="updates-change-detail updates-change-context">
      {lineup && (
        <div>
          <dt>{t("产品线位置", "Lineup")}</dt>
          <dd>
            {pick(lineup.lineName, lang)}
            {lineup.modelPositioning && <> · {pick(lineup.modelPositioning, lang)}</>}
            {lineup.siblings.length > 0 && (
              <span className="updates-change-context__note">
                {t("同系列在售：", "Also current: ")}
                {lineup.siblings.map((item) => modelDisplayName(item, lang)).join(t("、", ", "))}
              </span>
            )}
          </dd>
        </div>
      )}
      {access.length > 0 && (
        <div>
          <dt>{t("怎么用上", "Where to use it")}</dt>
          <dd>
            <ul className="updates-change-context__list">
              {access.map((channel) => {
                const [zh, en] = channelLabels[channel.type] ?? ["渠道", "Channel"];
                const label = `${channel.provider}${channel.modelId ? ` · ${channel.modelId}` : ""}`;
                return (
                  <li key={`${channel.type}-${channel.provider}-${channel.modelId ?? ""}`}>
                    <span className="updates-change-context__tag">{t(zh, en)}</span>
                    {channel.url ? (
                      <a href={channel.url} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          </dd>
        </div>
      )}
      {previous && (
        <div>
          <dt>{t("上一代", "Previous generation")}</dt>
          <dd>
            {modelDisplayName(previous, lang)}
            {(previous.release?.releasedAt ?? previous.firstReleasedAt) && (
              <> · {previous.release?.releasedAt ?? previous.firstReleasedAt}</>
            )}
          </dd>
        </div>
      )}
      {related.length > 0 && (
        <div>
          <dt>{t("相关动态", "Related updates")}</dt>
          <dd>
            <ul className="updates-change-context__list">
              {related.map((item) => {
                const entity = entityById.get(item.entityId);
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelectChange(item.id)}>
                      {item.date} · {kindLabel(item.kind)}
                      {entity && <> · {modelDisplayName(entity, lang)}</>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}
