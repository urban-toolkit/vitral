import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setNodes, setEdges } from "@/store/flowSlice";
import { createDocument, loadDocument, saveDocument } from "@/api/stateApi";
import { debounce } from "@/utils/debounce";

type SyncStatus = "idle" | "loading" | "saving" | "error" | "ready";

