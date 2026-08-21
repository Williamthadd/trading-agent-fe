import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  useTextScale,
} from "../hooks/useTextScale";

export type TerminalSessionStatus =
  | "initializing"
  | "ready"
  | "running"
  | "offline"
  | "INITIALIZING"
  | "READY"
  | "RUNNING"
  | "OFFLINE";

export interface TerminalStorageStatus {
  mode: "firebase" | "local" | "unavailable" | string;
  backend?: string;
  configured?: boolean;
  message?: string;
}

export interface TerminalHeaderProps {
  sessionStatus: TerminalSessionStatus;
  storage: TerminalStorageStatus;
  accountEmail?: string | null;
  onLogout: () => void | Promise<void>;
  canLogout?: boolean;
  isLoggingOut?: boolean;
  workstationId?: string;
  logoSrc?: string;
  workspaceTargetId?: string;
  /** Optional deterministic override. When omitted, browser online events win. */
  online?: boolean;
  className?: string;
}

interface StoragePresentation {
  label: string;
  state: "online" | "local" | "error";
}

function presentStorage(storage: TerminalStorageStatus): StoragePresentation {
  const mode = storage.mode.toLowerCase();

  if (mode === "firebase" && storage.configured !== false) {
    return { label: "FIREBASE", state: "online" };
  }

  if (mode === "local") {
    return { label: "LOCAL", state: "local" };
  }

  return { label: "UNAVAILABLE", state: "error" };
}

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function TerminalHeader({
  sessionStatus,
  storage,
  accountEmail,
  onLogout,
  canLogout = true,
  isLoggingOut = false,
  workstationId = "WEB-01",
  logoSrc = "/logo.png",
  workspaceTargetId = "workspace",
  online,
  className,
}: TerminalHeaderProps) {
  const [now, setNow] = useState(() => new Date());
  const [detectedOnline, setDetectedOnline] = useState(browserIsOnline);
  const textScale = useTextScale();

  useEffect(() => {
    const updateClock = () => setNow(new Date());
    const delay = 1_000 - (Date.now() % 1_000);
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      updateClock();
      intervalId = window.setInterval(updateClock, 1_000);
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    if (online !== undefined) {
      return undefined;
    }

    const markOnline = () => setDetectedOnline(true);
    const markOffline = () => setDetectedOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [online]);

  const clock = useMemo(() => {
    const date = new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
      .format(now)
      .toUpperCase();
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(now);
    const zone =
      new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value ?? "LOCAL";

    return { date, time, zone };
  }, [now]);

  const effectiveOnline = online ?? detectedOnline;
  const normalizedSession = effectiveOnline
    ? sessionStatus.toLowerCase()
    : "offline";
  const sessionLabel = normalizedSession.toUpperCase();
  const sessionState =
    normalizedSession === "offline"
      ? "error"
      : normalizedSession === "initializing"
        ? "local"
        : "online";
  const storageView = presentStorage(storage);
  const storageDescription = [storage.backend, storage.message]
    .filter(Boolean)
    .join(" — ");
  const rootClassName = ["terminal-header", className].filter(Boolean).join(" ");

  return (
    <>
      <a className="skip-link" href={`#${workspaceTargetId}`}>
        Skip to workspace
      </a>
      <header className={rootClassName} aria-label="TradingAgents workstation header">
        <div className="terminal-header__brand">
          <img className="terminal-header__logo" src={logoSrc} alt="" />
          <div className="terminal-header__identity">
            <p className="terminal-header__eyebrow">
              MULTI-AGENT MARKET INTELLIGENCE
            </p>
            <p className="terminal-header__wordmark" aria-label="TradingAgents">
              TRADING<span>AGENTS</span>
            </p>
          </div>
        </div>

        <div className="terminal-header__system" aria-label="System status">
          <div className="system-cell system-cell--workstation">
            <span className="system-cell__label">WORKSTATION</span>
            <span className="system-cell__value">{workstationId}</span>
          </div>

          <div className="system-cell system-cell--session">
            <span className="system-cell__label">SESSION</span>
            <span className={`system-state system-state--${sessionState}`}>
              <span className="status-dot" aria-hidden="true" />
              {sessionLabel}
            </span>
          </div>

          <div
            className="system-cell system-cell--storage"
            title={storageDescription || undefined}
          >
            <span className="system-cell__label">DATA STORE</span>
            <span className={`system-state system-state--${storageView.state}`}>
              <span className="status-dot" aria-hidden="true" />
              {storageView.label}
            </span>
          </div>

          <div className="system-cell system-cell--text-scale">
            <div className="text-scale__labels">
              <label className="system-cell__label" htmlFor="terminal-text-scale">
                TEXT SIZE
              </label>
              <output htmlFor="terminal-text-scale">{textScale.output}</output>
            </div>
            <input
              id="terminal-text-scale"
              className="text-scale__range"
              type="range"
              min={TEXT_SCALE_MIN}
              max={TEXT_SCALE_MAX}
              step={TEXT_SCALE_STEP}
              value={textScale.value}
              aria-valuetext={textScale.ariaValueText}
              onChange={textScale.onChange}
              style={
                { "--range-progress": textScale.rangeProgress } as CSSProperties
              }
            />
          </div>

          <div className="system-cell system-cell--account">
            <span className="system-cell__label">SIGNED IN</span>
            <div className="account-line">
              <span className="account-line__email" title={accountEmail ?? undefined}>
                {accountEmail || "LOCAL SESSION"}
              </span>
              {canLogout ? (
                <button
                  className="terminal-header__logout"
                  type="button"
                  onClick={() => void onLogout()}
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? "EXITING" : "LOGOUT"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="system-cell system-cell--clock">
            <span className="system-cell__label">LOCAL</span>
            <time className="terminal-clock" dateTime={now.toISOString()}>
              <span className="terminal-clock__date">{clock.date}</span>
              <span className="terminal-clock__time">
                {clock.time} <small>{clock.zone}</small>
              </span>
            </time>
          </div>
        </div>
      </header>
    </>
  );
}
