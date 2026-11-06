import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  QueryClient,
  QueryObserver,
  environmentManager,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { homeOverviewQueryOptions, HOME_SYNC_INTERVAL_MS, validateHomeOverview } =
  await vite.ssrLoadModule("/src/domain/home-sync.ts");
const initial = JSON.parse(await readFile("src/data/generated/home-overview.json", "utf8"));
const wasServer = environmentManager.isServer();
environmentManager.setIsServer(() => false);
test.after(async () => {
  environmentManager.setIsServer(() => wasServer);
  await vite.close();
});

async function until(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Expected query state did not arrive.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const changed = (count) => ({
  ...structuredClone(initial),
  claimCount: count,
  sourcedClaimCount: count,
});

test("first paint retains the bundle, then mount and interval automatically accept published changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  client.mount();
  let release;
  let calls = 0;
  let published = changed(initial.claimCount + 1);
  const options = homeOverviewQueryOptions(
    {
      mode: "live",
      getHomeOverview: async () => {
        calls++;
        if (calls === 1)
          return new Promise((resolve) => {
            release = resolve;
          });
        return published;
      },
    },
    initial,
  );
  assert.equal(HOME_SYNC_INTERVAL_MS, 300_000);
  assert.equal(options.refetchInterval, HOME_SYNC_INTERVAL_MS);
  assert.equal(options.refetchIntervalInBackground, false);
  // Accelerate only this observer's timer; the production policy remains five minutes.
  const observer = new QueryObserver(client, { ...options, refetchInterval: 20 });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.deepEqual(observer.getCurrentResult().data, initial);
    assert.equal(observer.getCurrentResult().dataUpdatedAt, 0);
    await until(() => Boolean(release));
    release(published);
    await until(() => observer.getCurrentResult().data.claimCount === initial.claimCount + 1);
    published = changed(initial.claimCount + 2);
    await until(() => observer.getCurrentResult().data.claimCount === initial.claimCount + 2);
    assert.ok(calls >= 2);

    observer.setOptions({ ...options, refetchInterval: false });
    focusManager.setFocused(false);
    published = changed(initial.claimCount + 3);
    focusManager.setFocused(true);
    await until(() => observer.getCurrentResult().data.claimCount === initial.claimCount + 3);

    onlineManager.setOnline(false);
    published = changed(initial.claimCount + 4);
    onlineManager.setOnline(true);
    await until(() => observer.getCurrentResult().data.claimCount === initial.claimCount + 4);
  } finally {
    unsubscribe();
    observer.destroy();
    client.unmount();
    client.clear();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
  }
});

test("network errors and malformed responses retain the last successful data and sync time, then recover", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  let published = changed(initial.claimCount + 5);
  let failure;
  const options = homeOverviewQueryOptions(
    {
      mode: "live",
      getHomeOverview: async () => {
        if (failure) throw failure;
        return published;
      },
    },
    initial,
  );
  const observer = new QueryObserver(client, { ...options, enabled: false, retry: false });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    const good = observer.getCurrentResult();
    assert.ok(good.dataUpdatedAt > 0);
    failure = new Error("isolated network failure");
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data, good.data);
    assert.equal(observer.getCurrentResult().dataUpdatedAt, good.dataUpdatedAt);
    assert.equal(observer.getCurrentResult().isRefetchError, true);
    failure = undefined;
    published = { claimCount: 1 };
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isRefetchError, true);
    assert.equal(observer.getCurrentResult().data, good.data);
    published = changed(initial.claimCount + 6);
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data.claimCount, initial.claimCount + 6);
    assert.equal(observer.getCurrentResult().isError, false);
  } finally {
    unsubscribe();
    observer.destroy();
    client.clear();
  }
});

test("offline mode does not auto-fetch and a genuine empty catalog is accepted", async () => {
  let calls = 0;
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const observer = new QueryObserver(
    client,
    homeOverviewQueryOptions(
      {
        mode: "demo",
        getHomeOverview: async () => {
          calls++;
          return initial;
        },
      },
      initial,
    ),
  );
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(calls, 0);
  assert.deepEqual(observer.getCurrentResult().data, initial);
  assert.equal(observer.getCurrentResult().dataUpdatedAt, 0);
  unsubscribe();
  observer.destroy();
  client.clear();
  const empty = {
    ...initial,
    entityCount: 0,
    claimCount: 0,
    sourcedClaimCount: 0,
    relationshipCount: 0,
    entities: [],
    evidence: [],
    changes: [],
    featuredRelations: [],
    researchQuestions: [],
    catalogUpdatedAt: null,
  };
  assert.equal(validateHomeOverview(empty), empty);
  assert.throws(() => validateHomeOverview({ ...initial, claimCount: -1 }));
  assert.throws(() => validateHomeOverview({ ...initial, entities: [{}] }));
});
