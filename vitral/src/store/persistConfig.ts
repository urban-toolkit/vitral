import type { PersistConfig } from "redux-persist";
import { indexedDBStorage } from "@/store/storage";

export const persistConfig: PersistConfig<any> = {
  key: "root",
  version: 1,
  storage: indexedDBStorage,

  // whitelist: ["flow"],
  whitelist: [], // TODO: persist preferences/settings

  migrate: async (state) => {
    return state;
  },
};
