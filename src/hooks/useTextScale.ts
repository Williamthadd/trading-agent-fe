import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

export const TEXT_SCALE_STORAGE_KEY = "tradingagents.web.textScale.v1";
export const TEXT_SCALE_MIN = 85;
export const TEXT_SCALE_MAX = 160;
export const TEXT_SCALE_STEP = 5;
export const TEXT_SCALE_DEFAULT = 110;
export const TEXT_SCALE_BASE_PX = 13;

export function normalizeTextScale(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return TEXT_SCALE_DEFAULT;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return TEXT_SCALE_DEFAULT;
  }

  const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, parsed));
  const stepped =
    TEXT_SCALE_MIN +
    Math.round((clamped - TEXT_SCALE_MIN) / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;

  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, stepped));
}

function readStoredTextScale(): number {
  if (typeof window === "undefined") {
    return TEXT_SCALE_DEFAULT;
  }

  try {
    return normalizeTextScale(window.localStorage.getItem(TEXT_SCALE_STORAGE_KEY));
  } catch {
    return TEXT_SCALE_DEFAULT;
  }
}

function applyTextScale(value: number): void {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--text-scale", String(value / 100));
  }
}

export interface TextScaleControl {
  value: number;
  scale: number;
  basePixels: number;
  output: string;
  ariaValueText: string;
  rangeProgress: string;
  setValue: (value: number) => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Owns the persisted workstation text scale and mirrors it to the root CSS
 * custom property. The pre-paint script in index.html uses the same constants
 * so this hook can take over without a visible size jump.
 */
export function useTextScale(): TextScaleControl {
  const [value, setRawValue] = useState<number>(readStoredTextScale);

  const setValue = useCallback((nextValue: number) => {
    setRawValue(normalizeTextScale(nextValue));
  }, []);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setValue(event.currentTarget.valueAsNumber);
    },
    [setValue],
  );

  useEffect(() => {
    applyTextScale(value);

    try {
      window.localStorage.setItem(TEXT_SCALE_STORAGE_KEY, String(value));
    } catch {
      // Scaling remains functional when storage is blocked or unavailable.
    }
  }, [value]);

  useEffect(() => {
    const synchronizeTabs = (event: StorageEvent) => {
      if (event.key === TEXT_SCALE_STORAGE_KEY) {
        setRawValue(normalizeTextScale(event.newValue));
      }
    };

    window.addEventListener("storage", synchronizeTabs);
    return () => window.removeEventListener("storage", synchronizeTabs);
  }, []);

  return useMemo(() => {
    const scale = value / 100;
    const basePixels = TEXT_SCALE_BASE_PX * scale;
    const output = `${value}% / ${basePixels.toFixed(1)}px`;
    const progress =
      ((value - TEXT_SCALE_MIN) / (TEXT_SCALE_MAX - TEXT_SCALE_MIN)) * 100;

    return {
      value,
      scale,
      basePixels,
      output,
      ariaValueText: output,
      rangeProgress: `${progress}%`,
      setValue,
      onChange,
    };
  }, [onChange, setValue, value]);
}
