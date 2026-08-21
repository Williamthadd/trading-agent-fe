export interface TickerRibbonItem {
  label: string;
  value: string;
}

export interface TickerRibbonProps {
  items?: readonly TickerRibbonItem[];
  notice?: string;
  className?: string;
}

const DEFAULT_ITEMS: readonly TickerRibbonItem[] = [
  { label: "TA", value: "SYSTEM" },
  { label: "MARKET", value: "MULTI-SOURCE" },
  { label: "RESEARCH", value: "AGENTIC" },
  { label: "RISK", value: "THREE-WAY DEBATE" },
];

export function TickerRibbon({
  items = DEFAULT_ITEMS,
  notice = "DATA IS FOR RESEARCH PURPOSES",
  className,
}: TickerRibbonProps) {
  const rootClassName = ["ticker-ribbon", className].filter(Boolean).join(" ");

  return (
    <section className={rootClassName} aria-label="Workstation capabilities">
      <div className="ticker-ribbon__items" tabIndex={0}>
        {items.map((item, index) => (
          <span className="ticker-ribbon__item" key={`${item.label}-${index}`}>
            <strong>{item.label}</strong>
            <span>{item.value}</span>
          </span>
        ))}
      </div>
      <p className="ticker-ribbon__notice">
        <span aria-hidden="true">◆</span>
        {notice}
      </p>
    </section>
  );
}
