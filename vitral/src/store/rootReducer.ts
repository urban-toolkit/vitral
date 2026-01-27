import { combineReducers } from "@reduxjs/toolkit";
import flowReducer from "@/store/flowSlice";
import filesReducer from "@/store/filesSlice";

export const rootReducer = combineReducers({
    flow: flowReducer,
    files: filesReducer,
});

export type RootState = ReturnType<typeof rootReducer>;
