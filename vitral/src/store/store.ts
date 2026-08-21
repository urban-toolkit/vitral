import { configureStore } from "@reduxjs/toolkit";
import { rootReducer } from "./rootReducer";

const isDev = import.meta.env.DEV;

export const store = configureStore({
    reducer: rootReducer,
    /*
     * RTK's two development checks deep-walk the entire state tree on every dispatch — twice over for
     * `immutableCheck`, which snapshots before and compares after. The document is both the largest
     * thing in the tree and the thing nearly every dispatch touches, and per-node `__history` arrays
     * make each node deep, so on a canvas of any size the checks dominated dispatch time. Inside
     * `createSlice` Immer already makes accidental mutation of those paths unreachable, so they were
     * paying full price for a class of bug that cannot occur there.
     *
     * They stay on for everything else, where a hand-written reducer or a thunk still could mutate.
     * RTK drops both entirely from a production build; the `isDev` is here to say so out loud.
     */
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({
        immutableCheck: isDev && {
            ignoredPaths: ["flow.nodes", "flow.edges", "files.byId", "timeline"],
            warnAfter: 32,
        },
        serializableCheck: isDev && {
            ignoredPaths: ["flow.nodes", "flow.edges", "files.byId", "timeline"],
            warnAfter: 32,
        },
    }),
    /*
     * Capped because the Redux DevTools extension, when installed, serialises every action and the
     * state it produced synchronously in the page — which on this document is not cheap.
     */
    devTools: isDev && { maxAge: 25, trace: false },
});

export type AppDispatch = typeof store.dispatch;
