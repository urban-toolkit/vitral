import { combineReducers } from "@reduxjs/toolkit";
import flowReducer from "@/store/flowSlice";
import filesReducer from "@/store/filesSlice";
import gitEventsReducer from "@/store/gitEventsSlice";

export const rootReducer = combineReducers({
    flow: flowReducer,
    files: filesReducer,
    gitEvents: gitEventsReducer 
});

export type RootState = ReturnType<typeof rootReducer>;
