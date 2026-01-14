import { configureStore, combineReducers } from '@reduxjs/toolkit';
import flowReducer from '@/store/flowSlice';

import {
    persistReducer,
    persistStore,
    FLUSH,
    REHYDRATE,
    PAUSE,
    PERSIST,
    PURGE,
    REGISTER,
} from "redux-persist";

import { persistConfig } from "@/store/persistConfig";

// const rootReducer = {
//     flow: flowReducer,
// };

const rootReducer = combineReducers({
  flow: flowReducer,
});


const persistedReducer = persistReducer(persistConfig, rootReducer as any);

export const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: [
                    FLUSH,
                    REHYDRATE,
                    PAUSE,
                    PERSIST,
                    PURGE,
                    REGISTER,
                ],
            },
        }),
});

// export const store = configureStore({
//     reducer: {
//         flow: flowReducer
//     }
// });

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;