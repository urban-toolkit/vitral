import localforage from "localforage";

export const indexedDBStorage = localforage.createInstance({
  name: "vitral",
  storeName: "flow-state",
  description: "Persisted flow",
});
