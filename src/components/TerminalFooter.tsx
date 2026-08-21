export interface TerminalShortcut {
  key: string;
  label: string;
}

export interface TerminalFooterProps {
  notice?: string;
  shortcuts?: readonly TerminalShortcut[];
  className?: string;
}

const DEFAULT_SHORTCUTS: readonly TerminalShortcut[] = [
  { key: "F1", label: "LIVE" },
  { key: "F2", label: "REPORTS" },
  { key: "F3", label: "DECISION" },
  { key: "CTRL+ENTER", label: "RUN" },
];

export function TerminalFooter({
  notice = "AI-GENERATED RESEARCH · VERIFY BEFORE TRADING",
  shortcuts = DEFAULT_SHORTCUTS,
  className,
}: TerminalFooterProps) {
  const rootClassName = ["terminal-footer", className].filter(Boolean).join(" ");

  return (
    <footer className={rootClassName}>
      <p className="terminal-footer__notice">
        <span className="status-dot status-dot--warning" aria-hidden="true" />
        {notice}
      </p>
      <dl className="terminal-footer__shortcuts" aria-label="Keyboard shortcuts">
        {shortcuts.map((shortcut) => (
          <div key={`${shortcut.key}-${shortcut.label}`}>
            <dt>{shortcut.key}</dt>
            <dd>{shortcut.label}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}
