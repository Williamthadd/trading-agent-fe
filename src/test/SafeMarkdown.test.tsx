import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "../components/SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders the supported report subset with semantic elements", () => {
    const markdown = [
      "# Market Outlook C#",
      "",
      "A **strong** view with *emphasis*, ~~removed risk~~, `const side = 'BUY'`, and BUY.",
      "",
      "> Evidence remains constructive.",
      "> Confirmation is required.",
      "",
      "- First item",
      "  wrapped continuation",
      "- Second item",
      "",
      "3. Third-ranked item",
      "4. Fourth-ranked item",
      "",
      "---",
      "",
      "| Asset | View | Weight |",
      "| :--- | :---: | ---: |",
      "| ACME | BUY | 42% |",
      "",
      "[Research](https://example.com/research)",
    ].join("\n");

    const { container } = render(<SafeMarkdown content={markdown} />);

    expect(screen.getByRole("heading", { level: 1, name: "Market Outlook C#" })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("strong");
    expect(container.querySelector("em")).toHaveTextContent("emphasis");
    expect(container.querySelector("del")).toHaveTextContent("removed risk");
    expect(container.querySelector("blockquote")).toHaveTextContent("Confirmation is required");
    expect(container.querySelector("ul li")).toHaveTextContent("First item wrapped continuation");
    expect(container.querySelector("ol")).toHaveAttribute("start", "3");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByLabelText("Scrollable analysis table")).toHaveAttribute("tabindex", "0");
    expect(container.querySelector("th.md-align-center")).toHaveTextContent("View");
    expect(container.querySelector("td.md-align-right")).toHaveTextContent("42%");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
    expect(container.querySelectorAll(".md-signal")).toHaveLength(2);
    expect(container.querySelector("code .md-signal")).toBeNull();
  });

  it("keeps adversarial HTML inert and exposes only the exact safe HTTPS link", () => {
    const adversarial = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      '<iframe src="https://evil.example"></iframe>',
      '<form action="https://evil.example"><input></form>',
      "<style>body{display:none}</style>",
      '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
      "[bad](javascript:alert(1))",
      "[bad](data:text/html,boom)",
      "[bad](vbscript:msgbox(1))",
      "[bad](file:///etc/passwd)",
      "[bad](/relative/path)",
      "[bad](//evil.example/path)",
      "[bad](https://trusted.example@evil.example/path)",
      "[good](https://example.com/research)",
    ].join("\n");

    const { container } = render(<SafeMarkdown content={adversarial} />);

    for (const forbidden of ["script", "img", "svg", "iframe", "form", "style", "input"]) {
      expect(container.querySelector(forbidden)).toBeNull();
    }
    expect(container.querySelector("[onerror], [onclick], [style], [src]")).toBeNull();

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/research");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(container).toHaveTextContent("[bad](javascript:alert(1))");
  });

  it("never mounts Markdown images or turns their fallback into a link", () => {
    const { container } = render(
      <SafeMarkdown content="![remote BUY chart](https://example.com/tracker.png)" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("![remote BUY chart](https://example.com/tracker.png)");
  });

  it("uses compact signal chips outside code while keeping ordinary bold text neutral", () => {
    const { container } = render(
      <SafeMarkdown content={"BUY, STRONG SELL, HOLD, and **ordinary emphasis**. `SELL BUY`"} />,
    );

    expect(container.querySelectorAll(".md-signal--positive")).toHaveLength(1);
    expect(container.querySelectorAll(".md-signal--negative")).toHaveLength(1);
    expect(container.querySelectorAll(".md-signal--neutral")).toHaveLength(1);
    expect(container.querySelector("strong")).not.toHaveClass("md-signal");
    expect(container.querySelector("code")).toHaveTextContent("SELL BUY");
    expect(container.querySelector("code")?.querySelector(".md-signal")).toBeNull();
  });

  it("renders fenced code as text and sanitizes the language class", () => {
    const markdown = '```js" onclick="alert(1)\n<img src=x onerror=alert(1)>\n```';
    const { container } = render(<SafeMarkdown content={markdown} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onclick], [src]")).toBeNull();
    expect(screen.getByLabelText("Scrollable code block")).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
    expect(container.querySelector("code")).not.toHaveAttribute("class");
  });

  it("treats a malformed, unterminated fence as one safe code block", () => {
    const { container } = render(
      <SafeMarkdown content={"```tsx\nconst path = String.raw`C:\\\\market\\\\alpha`;\n<script>alert(1)</script>"} />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("code.language-tsx")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("handles 60,000 unmatched link openers without creating interactive content", () => {
    const source = "[".repeat(60_000);
    const startedAt = performance.now();
    const { container } = render(<SafeMarkdown content={source} />);

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toHaveLength(source.length);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
  });

  it("falls back to one literal remainder when the inline token budget is exhausted", () => {
    const source = Array.from({ length: 1_001 }, () => "BUY").join(" ");
    const { container } = render(<SafeMarkdown content={source} />);

    expect(container.querySelectorAll(".md-signal")).toHaveLength(1_000);
    expect(screen.getByLabelText("Unparsed Markdown remainder")).toHaveTextContent("BUY");
    expect(container.querySelectorAll('[data-markdown-budget-exhausted="true"]')).toHaveLength(1);
  });

  it("falls back safely for over-budget lists", () => {
    const source = Array.from({ length: 501 }, (_, index) => `- row ${index}`).join("\n");
    const { container } = render(<SafeMarkdown content={source} />);

    expect(container.querySelectorAll("li")).toHaveLength(500);
    expect(screen.getByLabelText("Unparsed Markdown remainder")).toHaveTextContent("- row 500");
  });

  it("falls back safely for a pipe-heavy table that exceeds the cell budget", () => {
    const header = `| ${Array.from({ length: 24 }, (_, index) => `H${index}`).join(" | ")} |`;
    const delimiter = `| ${Array.from({ length: 24 }, () => "---").join(" | ")} |`;
    const row = `| ${Array.from({ length: 24 }, () => "BUY").join(" | ")} |`;
    const source = [header, delimiter, ...Array.from({ length: 50 }, () => row)].join("\n");
    const { container } = render(<SafeMarkdown content={source} />);

    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByLabelText("Unparsed Markdown remainder")).toHaveTextContent("H0");
  });

  it("caps tables at 24 columns", () => {
    const header = `| ${Array.from({ length: 25 }, (_, index) => `H${index}`).join(" | ")} |`;
    const delimiter = `| ${Array.from({ length: 25 }, () => "---").join(" | ")} |`;
    const { container } = render(<SafeMarkdown content={`${header}\n${delimiter}`} />);

    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByLabelText("Unparsed Markdown remainder")).toHaveTextContent("H24");
  });

  it("falls back safely after 1,000 blocks", () => {
    const source = Array.from({ length: 1_001 }, (_, index) => `paragraph ${index}`).join("\n\n");
    const { container } = render(<SafeMarkdown content={source} />);

    expect(container.querySelectorAll("p")).toHaveLength(1_000);
    expect(screen.getByLabelText("Unparsed Markdown remainder")).toHaveTextContent("paragraph 1000");
  });

  it("preserves Windows paths and C# inside headings", () => {
    render(<SafeMarkdown content={String.raw`## C# model at C:\market\alpha`} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      String.raw`C# model at C:\market\alpha`,
    );
  });

  it("preserves the rendered DOM for an unchanged memoized input", () => {
    const { container, rerender } = render(<SafeMarkdown content="# Stable report" />);
    const originalHeading = container.querySelector("h1");

    rerender(<SafeMarkdown content="# Stable report" />);

    expect(container.querySelector("h1")).toBe(originalHeading);
  });
});
