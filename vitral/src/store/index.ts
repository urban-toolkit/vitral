import { configureStore } from '@reduxjs/toolkit';
import flowReducer from '@/store/flowSlice';

export const store = configureStore({
    reducer: {
        flow: flowReducer
    }
});

export type RootState = ReturnType<typeof store.getState>;