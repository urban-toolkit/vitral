import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import classes from "./StagePicker.module.css";

export type StagePickerProps = {
  isOpen: boolean;
  x: number;
  y: number;
  currentValue: string;
  options: string[];
  onClose: () => void;
  onSelect: (value: string) => void;
  onCreate: (value: string) => void;
};

export function StagePicker({
  isOpen,
  x,
  y,
  currentValue,
  options,
  onClose,
  onSelect,
  onCreate,
}: StagePickerProps) {
  const [newTag, setNewTag] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;

      // click outside
      if (!el.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  const color = useMemo(() => {
    return d3.scaleOrdinal<string, string>().domain(options).range(d3.schemePastel2);
  }, [options]);

  if (!isOpen) return null;

  return (
    <div
      ref={rootRef}
      className={classes.root}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className={classes.header}>
        <input
          className={classes.input}
          placeholder="New stage… (Enter)"
          value={newTag}
          autoFocus
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") {
              const t = newTag.trim();
              if (!t) return;
              onCreate(t);
              setNewTag("");
            }
          }}
        />
      </div>

      <div className={classes.pills}>
        {options.map((t) => (
          <button
            key={t}
            type="button"
            className={`${classes.pill} ${t === currentValue ? classes.pillActive : ""}`}
            style={{ background: color(t) }}
            onClick={() => onSelect(t)}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
