import { memo, useMemo } from "react";

import { renderSafeMarkdown } from "../markdown/renderSafeMarkdown";
import "../styles/markdown.css";

export interface SafeMarkdownProps {
  /** Untrusted Markdown returned by the API. */
  readonly content: string;
  readonly className?: string;
  readonly ariaLabel?: string;
}

function SafeMarkdownView({ content, className, ariaLabel }: SafeMarkdownProps) {
  const rendered = useMemo(() => renderSafeMarkdown(content), [content]);
  const classes = className === undefined ? "safe-markdown" : `safe-markdown ${className}`;

  return (
    <div aria-label={ariaLabel} className={classes} data-safe-markdown="true">
      {rendered}
    </div>
  );
}

export const SafeMarkdown = memo(
  SafeMarkdownView,
  (previous, next) =>
    previous.content === next.content &&
    previous.className === next.className &&
    previous.ariaLabel === next.ariaLabel,
);

SafeMarkdown.displayName = "SafeMarkdown";

export default SafeMarkdown;
