// The family timeline is the authority for release events. Review timestamps,
// undated versions and conflicting dates cannot manufacture a release.
export function catalogReleaseChanges(snapshot) {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const evidence = new Map(snapshot.evidence.map((source) => [source.id, source]));
  const changes = new Map();
  for (const [familyId, events] of Object.entries(snapshot.timeline)) {
    for (const event of events) {
      const version = entities.get(event.releaseEntityId);
      if (
        !version?.release ||
        version.familyId !== familyId ||
        version.release.stage === "pending" ||
        event.kind !== "release" ||
        event.dateKind !== "release" ||
        event.confidence !== "verified" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
        !validDate(event.date) ||
        event.date !== (version.release.releasedAt ?? version.firstReleasedAt)
      )
        continue;
      const sourceIds = [...new Set(event.sourceIds ?? [])].filter((id) => {
        const source = evidence.get(id);
        if (!source || source.type !== "official" || !source.verifiedAt) return false;
        try {
          const url = new URL(source.url);
          return url.protocol === "https:" && Boolean(url.hostname);
        } catch {
          return false;
        }
      });
      if (!sourceIds.length) continue;
      const id = `change-release-${version.id}`;
      changes.set(id, {
        id,
        entityId: version.id,
        date: event.date,
        summary: event.title,
        kind: "new",
        confidence: "verified",
        sourceIds,
      });
    }
  }
  return [...changes.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

function validDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function catalogChanges(snapshot) {
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const sources = new Map(snapshot.evidence.map((source) => [source.id, source]));
  const claims = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
  const changes = new Map(catalogReleaseChanges(snapshot).map((change) => [change.id, change]));
  for (const [ownerId, events] of Object.entries(snapshot.timeline)) {
    for (const event of events) {
      const entityId = event.releaseEntityId ?? ownerId;
      const entity = entities.get(entityId);
      if (
        !entity ||
        (entityId !== ownerId && entity.familyId !== ownerId) ||
        !["updated", "deprecated", "benchmark", "pricing", "availability"].includes(
          event.changeKind,
        ) ||
        event.dateKind !== "announcement" ||
        event.confidence !== "verified" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
        !validDate(event.date) ||
        !event.detail
      )
        continue;
      const sourceIds = [...new Set(event.sourceIds ?? [])].filter((id) => {
        const source = sources.get(id);
        if (
          !source ||
          source.type !== "official" ||
          !source.verifiedAt ||
          !source.sourceExcerpt ||
          !source.supportsClaimIds?.some((id) => {
            const claim = claims.get(id);
            return (
              claim?.confidence === "verified" &&
              claim.entityId === entityId &&
              claim.validFrom === event.date &&
              claim.sourceIds.includes(source.id)
            );
          })
        )
          return false;
        try {
          const url = new URL(source.url);
          return url.protocol === "https:" && Boolean(url.hostname);
        } catch {
          return false;
        }
      });
      if (!sourceIds.length) continue;
      const id = `change-event-${event.id}`;
      changes.set(id, {
        id,
        entityId,
        date: event.date,
        summary: event.title,
        kind: event.changeKind,
        confidence: "verified",
        sourceIds,
        detail: event.detail,
      });
    }
  }
  return [...changes.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}
