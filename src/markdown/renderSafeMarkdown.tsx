import { type ReactNode } from "react";

export const MARKDOWN_BUDGETS = Object.freeze({
  blocks: 1_000,
  inlineTokens: 1_000,
  listItems: 500,
  tableCells: 1_200,
  tableColumns: 24,
  linkLabelCharacters: 512,
  linkUrlCharacters: 2_048,
});

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly nextStart: number;
}

interface BudgetState {
  blocks: number;
  inlineTokens: number;
  listItems: number;
  tableCells: number;
  exhaustedAt: number | null;
}

interface RenderContext {
  readonly source: string;
  readonly budget: BudgetState;
  key: number;
}

interface InlinePart {
  readonly text: string;
  readonly start: number;
}

interface ListMarker {
  readonly ordered: boolean;
  readonly startNumber: number;
  readonly content: string;
  readonly contentStart: number;
}

interface FenceMarker {
  readonly character: "`" | "~";
  readonly length: number;
  readonly language: string | null;
}

type TableAlignment = "left" | "center" | "right" | null;

interface TableCellSource {
  readonly text: string;
  readonly start: number;
}

interface SplitTableRow {
  readonly cells: readonly TableCellSource[];
  readonly overflow: boolean;
}

interface SignalDefinition {
  readonly text: string;
  readonly tone: "positive" | "negative" | "neutral";
}

const SIGNALS: readonly SignalDefinition[] = [
  { text: "STRONG BUY", tone: "positive" },
  { text: "STRONG SELL", tone: "negative" },
  { text: "UNDERWEIGHT", tone: "negative" },
  { text: "OVERWEIGHT", tone: "positive" },
  { text: "BULLISH", tone: "positive" },
  { text: "BEARISH", tone: "negative" },
  { text: "DOWNSIDE", tone: "negative" },
  { text: "NEUTRAL", tone: "neutral" },
  { text: "UPSIDE", tone: "positive" },
  { text: "HOLD", tone: "neutral" },
  { text: "SELL", tone: "negative" },
  { text: "BUY", tone: "positive" },
] as const;

function nextKey(context: RenderContext, prefix: string): string {
  const key = `${prefix}-${context.key}`;
  context.key += 1;
  return key;
}

function exhaustAt(context: RenderContext, offset: number): void {
  if (context.budget.exhaustedAt === null) {
    context.budget.exhaustedAt = Math.max(0, Math.min(offset, context.source.length));
  }
}

function claimBlock(context: RenderContext, offset: number): boolean {
  if (context.budget.blocks >= MARKDOWN_BUDGETS.blocks) {
    exhaustAt(context, offset);
    return false;
  }

  context.budget.blocks += 1;
  return true;
}

function claimInlineToken(context: RenderContext, offset: number): boolean {
  if (context.budget.inlineTokens >= MARKDOWN_BUDGETS.inlineTokens) {
    exhaustAt(context, offset);
    return false;
  }

  context.budget.inlineTokens += 1;
  return true;
}

function splitSourceLines(source: string): SourceLine[] {
  if (source.length === 0) {
    return [];
  }

  const lines: SourceLine[] = [];
  let lineStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) !== 10) {
      continue;
    }

    const end = index > lineStart && source.charCodeAt(index - 1) === 13 ? index - 1 : index;
    lines.push({
      text: source.slice(lineStart, end),
      start: lineStart,
      end,
      nextStart: index + 1,
    });
    lineStart = index + 1;
  }

  if (lineStart <= source.length) {
    let end = source.length;
    if (end > lineStart && source.charCodeAt(end - 1) === 13) {
      end -= 1;
    }
    lines.push({ text: source.slice(lineStart, end), start: lineStart, end, nextStart: source.length });
  }

  return lines;
}

function isBlank(line: SourceLine): boolean {
  return line.text.trim().length === 0;
}

function isAsciiWordCharacter(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function signalAt(text: string, index: number): SignalDefinition | null {
  if (isAsciiWordCharacter(text[index - 1])) {
    return null;
  }

  for (const signal of SIGNALS) {
    if (index + signal.text.length > text.length) {
      continue;
    }

    if (text.slice(index, index + signal.text.length).toUpperCase() !== signal.text) {
      continue;
    }

    if (isAsciiWordCharacter(text[index + signal.text.length])) {
      continue;
    }

    return signal;
  }

  return null;
}

function renderPlainText(text: string, absoluteStart: number, context: RenderContext): ReactNode[] {
  if (text.length === 0 || context.budget.exhaustedAt !== null) {
    return [];
  }

  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let index = 0;

  while (index < text.length) {
    const signal = signalAt(text, index);
    if (signal === null) {
      index += 1;
      continue;
    }

    if (index > plainStart) {
      nodes.push(text.slice(plainStart, index));
    }

    if (!claimInlineToken(context, absoluteStart + index)) {
      return nodes;
    }

    const displayed = text.slice(index, index + signal.text.length);
    nodes.push(
      <span
        className={`md-signal md-signal--${signal.tone}`}
        data-signal={signal.text}
        key={nextKey(context, "signal")}
      >
        {displayed}
      </span>,
    );
    index += signal.text.length;
    plainStart = index;
  }

  if (plainStart < text.length) {
    nodes.push(text.slice(plainStart));
  }

  return nodes;
}

function safeHttpUrl(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > MARKDOWN_BUDGETS.linkUrlCharacters ||
    value !== value.trim() ||
    (!value.startsWith("http://") && !value.startsWith("https://"))
  ) {
    return null;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) {
      return null;
    }
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.hostname.length === 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function delimiterClosingIndex(
  text: string,
  delimiter: "**" | "__" | "~~" | "*" | "_" | "`",
  from: number,
): number {
  let position = text.indexOf(delimiter, from);

  if (delimiter === "*" || delimiter === "_") {
    while (position >= 0) {
      const beforeMatches = position > 0 && text[position - 1] === delimiter;
      const afterMatches = position + 1 < text.length && text[position + 1] === delimiter;
      if (!beforeMatches && !afterMatches) {
        return position;
      }
      position = text.indexOf(delimiter, position + 1);
    }
  }

  return position;
}

function parseInline(text: string, absoluteStart: number, context: RenderContext, depth = 0): ReactNode[] {
  if (text.length === 0 || context.budget.exhaustedAt !== null) {
    return [];
  }

  if (depth >= 12) {
    return renderPlainText(text, absoluteStart, context);
  }

  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let index = 0;
  let nextLinkClose = text.indexOf("](");
  let nextLinkEnd = nextLinkClose >= 0 ? text.indexOf(")", nextLinkClose + 2) : -1;
  const failedDelimiters = new Set<string>();

  const flushPlain = (end: number): boolean => {
    if (end > plainStart) {
      nodes.push(...renderPlainText(text.slice(plainStart, end), absoluteStart + plainStart, context));
    }
    return context.budget.exhaustedAt === null;
  };

  const updateLinkPositions = (): void => {
    while (nextLinkClose >= 0 && nextLinkClose < index + 1) {
      nextLinkClose = text.indexOf('](', nextLinkClose + 2);
      if (nextLinkClose >= 0) {
        nextLinkEnd = text.indexOf(")", nextLinkClose + 2);
      } else {
        nextLinkEnd = -1;
      }
    }
  };

  while (index < text.length && context.budget.exhaustedAt === null) {
    updateLinkPositions();

    const isImage = text[index] === "!" && text[index + 1] === "[";
    const isLink = text[index] === "[";
    if (isImage || isLink) {
      const bracketIndex = isImage ? index + 1 : index;
      const labelLength = nextLinkClose - bracketIndex - 1;
      const urlLength = nextLinkEnd - nextLinkClose - 2;
      const hasCompleteSyntax =
        nextLinkClose >= bracketIndex + 1 &&
        nextLinkEnd >= nextLinkClose + 2 &&
        labelLength <= MARKDOWN_BUDGETS.linkLabelCharacters &&
        urlLength <= MARKDOWN_BUDGETS.linkUrlCharacters;

      if (hasCompleteSyntax) {
        if (!flushPlain(index)) {
          break;
        }

        const syntaxEnd = nextLinkEnd + 1;
        const rawSyntax = text.slice(index, syntaxEnd);
        if (isImage) {
          nodes.push(rawSyntax);
        } else {
          const labelStart = bracketIndex + 1;
          const label = text.slice(labelStart, nextLinkClose);
          const hrefSource = text.slice(nextLinkClose + 2, nextLinkEnd);
          const href = safeHttpUrl(hrefSource);

          if (href === null) {
            nodes.push(...renderPlainText(rawSyntax, absoluteStart + index, context));
          } else if (claimInlineToken(context, absoluteStart + index)) {
            nodes.push(
              <a
                href={href}
                key={nextKey(context, "link")}
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                {parseInline(label, absoluteStart + labelStart, context, depth + 1)}
              </a>,
            );
          }
        }

        index = syntaxEnd;
        plainStart = index;
        continue;
      }
    }

    let delimiter: "**" | "__" | "~~" | "*" | "_" | "`" | null = null;
    if (text.startsWith("**", index)) {
      delimiter = "**";
    } else if (text.startsWith("__", index)) {
      delimiter = "__";
    } else if (text.startsWith("~~", index)) {
      delimiter = "~~";
    } else if (text[index] === "`") {
      delimiter = "`";
    } else if (text[index] === "*" && text[index + 1] !== "*") {
      delimiter = "*";
    } else if (text[index] === "_" && text[index + 1] !== "_") {
      delimiter = "_";
    }

    if (delimiter === null || failedDelimiters.has(delimiter)) {
      index += 1;
      continue;
    }

    const closing = delimiterClosingIndex(text, delimiter, index + delimiter.length);
    if (closing < 0 || closing === index + delimiter.length) {
      failedDelimiters.add(delimiter);
      index += delimiter.length;
      continue;
    }

    if (!flushPlain(index) || !claimInlineToken(context, absoluteStart + index)) {
      break;
    }

    const innerStart = index + delimiter.length;
    const innerText = text.slice(innerStart, closing);
    if (delimiter === "`") {
      nodes.push(<code key={nextKey(context, "code")}>{innerText}</code>);
    } else {
      const children = parseInline(innerText, absoluteStart + innerStart, context, depth + 1);
      if (delimiter === "**" || delimiter === "__") {
        nodes.push(<strong key={nextKey(context, "strong")}>{children}</strong>);
      } else if (delimiter === "~~") {
        nodes.push(<del key={nextKey(context, "strike")}>{children}</del>);
      } else {
        nodes.push(<em key={nextKey(context, "emphasis")}>{children}</em>);
      }
    }

    index = closing + delimiter.length;
    plainStart = index;
  }

  if (context.budget.exhaustedAt === null) {
    flushPlain(text.length);
  }

  return nodes;
}

function readFence(line: SourceLine): FenceMarker | null {
  let index = 0;
  while (index < line.text.length && index < 3 && line.text[index] === " ") {
    index += 1;
  }

  const character = line.text[index];
  if (character !== "`" && character !== "~") {
    return null;
  }

  let runEnd = index;
  while (runEnd < line.text.length && line.text[runEnd] === character) {
    runEnd += 1;
  }

  const length = runEnd - index;
  if (length < 3) {
    return null;
  }

  const info = line.text.slice(runEnd).trim();
  const firstWhitespace = info.search(/[\t ]/u);
  const candidate = (firstWhitespace < 0 ? info : info.slice(0, firstWhitespace)).slice(0, 32);
  const language = /^[A-Za-z0-9][A-Za-z0-9_+#.-]{0,31}$/u.test(candidate) ? candidate.toLowerCase() : null;
  return { character, length, language };
}

function isClosingFence(line: SourceLine, opening: FenceMarker): boolean {
  let index = 0;
  while (index < line.text.length && index < 3 && line.text[index] === " ") {
    index += 1;
  }

  let runEnd = index;
  while (runEnd < line.text.length && line.text[runEnd] === opening.character) {
    runEnd += 1;
  }

  return runEnd - index >= opening.length && line.text.slice(runEnd).trim().length === 0;
}

function headingLevel(line: SourceLine): number {
  let index = 0;
  while (index < line.text.length && index < 3 && line.text[index] === " ") {
    index += 1;
  }

  const hashStart = index;
  while (index < line.text.length && index - hashStart < 7 && line.text[index] === "#") {
    index += 1;
  }

  const level = index - hashStart;
  if (level < 1 || level > 6 || (line.text[index] !== " " && line.text[index] !== "\t")) {
    return 0;
  }
  return level;
}

function headingContent(line: SourceLine, level: number): InlinePart {
  let index = 0;
  while (index < line.text.length && line.text[index] === " ") {
    index += 1;
  }
  index += level;
  while (index < line.text.length && (line.text[index] === " " || line.text[index] === "\t")) {
    index += 1;
  }

  let end = line.text.length;
  while (end > index && (line.text[end - 1] === " " || line.text[end - 1] === "\t")) {
    end -= 1;
  }
  let trailingHash = end;
  while (trailingHash > index && line.text[trailingHash - 1] === "#") {
    trailingHash -= 1;
  }
  if (trailingHash > index && trailingHash < end && /[\t ]/u.test(line.text[trailingHash - 1] ?? "")) {
    end = trailingHash - 1;
    while (end > index && (line.text[end - 1] === " " || line.text[end - 1] === "\t")) {
      end -= 1;
    }
  }

  return { text: line.text.slice(index, end), start: line.start + index };
}

function isHorizontalRule(line: SourceLine): boolean {
  const trimmed = line.text.trim();
  if (trimmed.length < 3) {
    return false;
  }

  let marker: string | null = null;
  let count = 0;
  for (const character of trimmed) {
    if (character === " " || character === "\t") {
      continue;
    }
    if (character !== "-" && character !== "_" && character !== "*") {
      return false;
    }
    if (marker === null) {
      marker = character;
    } else if (marker !== character) {
      return false;
    }
    count += 1;
  }
  return count >= 3;
}

function readListMarker(line: SourceLine): ListMarker | null {
  const unordered = /^ {0,3}[-+*][\t ]+(.+)$/u.exec(line.text);
  if (unordered !== null && unordered[1] !== undefined) {
    const content = unordered[1];
    const offset = line.text.length - content.length;
    return { ordered: false, startNumber: 1, content, contentStart: line.start + offset };
  }

  const ordered = /^ {0,3}(\d{1,9})[.)][\t ]+(.+)$/u.exec(line.text);
  if (ordered !== null && ordered[1] !== undefined && ordered[2] !== undefined) {
    const content = ordered[2];
    const offset = line.text.length - content.length;
    const parsedStart = Number.parseInt(ordered[1], 10);
    return {
      ordered: true,
      startNumber: Number.isSafeInteger(parsedStart) ? parsedStart : 1,
      content,
      contentStart: line.start + offset,
    };
  }

  return null;
}

function readListContinuation(line: SourceLine): InlinePart | null {
  let index = 0;
  let indentation = 0;
  while (index < line.text.length && (line.text[index] === " " || line.text[index] === "\t")) {
    indentation += line.text[index] === "\t" ? 2 : 1;
    index += 1;
  }

  if (indentation < 2 || index >= line.text.length) {
    return null;
  }
  return { text: line.text.slice(index), start: line.start + index };
}

function readBlockquotePart(line: SourceLine): InlinePart | null {
  let index = 0;
  while (index < line.text.length && index < 3 && line.text[index] === " ") {
    index += 1;
  }
  if (line.text[index] !== ">") {
    return null;
  }
  index += 1;
  if (line.text[index] === " ") {
    index += 1;
  }
  return { text: line.text.slice(index), start: line.start + index };
}

function splitTableRow(line: SourceLine): SplitTableRow {
  let start = 0;
  let end = line.text.length;
  while (start < end && (line.text[start] === " " || line.text[start] === "\t")) {
    start += 1;
  }
  while (end > start && (line.text[end - 1] === " " || line.text[end - 1] === "\t")) {
    end -= 1;
  }
  if (line.text[start] === "|") {
    start += 1;
  }
  if (end > start && line.text[end - 1] === "|") {
    end -= 1;
  }

  const cells: TableCellSource[] = [];
  let cellStart = start;
  let escaped = false;
  let inCode = false;
  let overflow = false;

  const addCell = (cellEnd: number): void => {
    if (cells.length >= MARKDOWN_BUDGETS.tableColumns + 1) {
      overflow = true;
      return;
    }
    let trimmedStart = cellStart;
    let trimmedEnd = cellEnd;
    while (trimmedStart < trimmedEnd && (line.text[trimmedStart] === " " || line.text[trimmedStart] === "\t")) {
      trimmedStart += 1;
    }
    while (trimmedEnd > trimmedStart && (line.text[trimmedEnd - 1] === " " || line.text[trimmedEnd - 1] === "\t")) {
      trimmedEnd -= 1;
    }
    cells.push({ text: line.text.slice(trimmedStart, trimmedEnd), start: line.start + trimmedStart });
  };

  for (let index = start; index < end; index += 1) {
    const character = line.text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      inCode = !inCode;
      continue;
    }
    if (character === "|" && !inCode) {
      addCell(index);
      cellStart = index + 1;
      if (overflow) {
        return { cells, overflow: true };
      }
    }
  }
  addCell(end);
  return { cells, overflow };
}

function delimiterAlignment(value: string): TableAlignment | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 3) {
    return undefined;
  }
  let start = 0;
  let end = trimmed.length;
  const left = trimmed[start] === ":";
  if (left) {
    start += 1;
  }
  const right = end > start && trimmed[end - 1] === ":";
  if (right) {
    end -= 1;
  }
  if (end - start < 3) {
    return undefined;
  }
  for (let index = start; index < end; index += 1) {
    if (trimmed[index] !== "-") {
      return undefined;
    }
  }
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return "left";
}

function readTable(
  lines: readonly SourceLine[],
  index: number,
): { header: SplitTableRow; alignments: readonly TableAlignment[]; rows: readonly SplitTableRow[]; nextIndex: number } | null {
  const headerLine = lines[index];
  const delimiterLine = lines[index + 1];
  if (
    headerLine === undefined ||
    delimiterLine === undefined ||
    !headerLine.text.includes("|") ||
    !delimiterLine.text.includes("|")
  ) {
    return null;
  }

  const header = splitTableRow(headerLine);
  const delimiter = splitTableRow(delimiterLine);
  if (
    header.overflow ||
    delimiter.overflow ||
    header.cells.length === 0 ||
    header.cells.length !== delimiter.cells.length
  ) {
    return null;
  }

  const alignments: TableAlignment[] = [];
  for (const cell of delimiter.cells) {
    const alignment = delimiterAlignment(cell.text);
    if (alignment === undefined) {
      return null;
    }
    alignments.push(alignment);
  }

  const rows: SplitTableRow[] = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const rowLine = lines[cursor];
    if (rowLine === undefined || isBlank(rowLine) || !rowLine.text.includes("|")) {
      break;
    }
    const row = splitTableRow(rowLine);
    if (row.overflow || row.cells.length > header.cells.length) {
      break;
    }
    rows.push(row);
    cursor += 1;
  }

  return { header, alignments, rows, nextIndex: cursor };
}

function alignmentClass(alignment: TableAlignment): string | undefined {
  return alignment === null ? undefined : `md-align-${alignment}`;
}

function isPotentialBlockStart(lines: readonly SourceLine[], index: number): boolean {
  const line = lines[index];
  if (line === undefined || isBlank(line)) {
    return true;
  }
  return (
    readFence(line) !== null ||
    headingLevel(line) > 0 ||
    isHorizontalRule(line) ||
    readListMarker(line) !== null ||
    readBlockquotePart(line) !== null ||
    readTable(lines, index) !== null
  );
}

function renderTable(
  table: NonNullable<ReturnType<typeof readTable>>,
  tableStart: number,
  context: RenderContext,
): ReactNode | null {
  const columnCount = table.header.cells.length;
  if (columnCount > MARKDOWN_BUDGETS.tableColumns) {
    exhaustAt(context, tableStart);
    return null;
  }

  const cellCount = columnCount * (table.rows.length + 1);
  if (context.budget.tableCells + cellCount > MARKDOWN_BUDGETS.tableCells) {
    exhaustAt(context, tableStart);
    return null;
  }
  context.budget.tableCells += cellCount;

  const headerCells = table.header.cells.map((cell, cellIndex) => (
    <th className={alignmentClass(table.alignments[cellIndex] ?? null)} key={nextKey(context, "th")} scope="col">
      {parseInline(cell.text, cell.start, context)}
    </th>
  ));

  const bodyRows: ReactNode[] = [];
  for (const row of table.rows) {
    const cells: ReactNode[] = [];
    for (let cellIndex = 0; cellIndex < columnCount; cellIndex += 1) {
      const cell = row.cells[cellIndex];
      cells.push(
        <td className={alignmentClass(table.alignments[cellIndex] ?? null)} key={nextKey(context, "td")}>
          {cell === undefined ? null : parseInline(cell.text, cell.start, context)}
        </td>,
      );
      if (context.budget.exhaustedAt !== null) {
        break;
      }
    }
    bodyRows.push(<tr key={nextKey(context, "tr")}>{cells}</tr>);
    if (context.budget.exhaustedAt !== null) {
      break;
    }
  }

  return (
    <div aria-label="Scrollable analysis table" className="md-table-scroll" key={nextKey(context, "table-wrap")} tabIndex={0}>
      <table>
        <thead>
          <tr>{headerCells}</tr>
        </thead>
        <tbody>{bodyRows}</tbody>
      </table>
    </div>
  );
}

function renderList(
  lines: readonly SourceLine[],
  startIndex: number,
  marker: ListMarker,
  context: RenderContext,
): { node: ReactNode; nextIndex: number } {
  const items: ReactNode[] = [];
  let cursor = startIndex;

  while (cursor < lines.length && context.budget.exhaustedAt === null) {
    const line = lines[cursor];
    if (line === undefined) {
      break;
    }
    const currentMarker = readListMarker(line);
    if (currentMarker === null || currentMarker.ordered !== marker.ordered) {
      break;
    }
    if (context.budget.listItems >= MARKDOWN_BUDGETS.listItems) {
      exhaustAt(context, line.start);
      break;
    }
    context.budget.listItems += 1;

    const itemChildren: ReactNode[] = parseInline(currentMarker.content, currentMarker.contentStart, context);
    cursor += 1;
    while (cursor < lines.length && context.budget.exhaustedAt === null) {
      const continuationLine = lines[cursor];
      if (continuationLine === undefined || isBlank(continuationLine) || readListMarker(continuationLine) !== null) {
        break;
      }
      const continuation = readListContinuation(continuationLine);
      if (continuation === null) {
        break;
      }
      itemChildren.push(" ", ...parseInline(continuation.text, continuation.start, context));
      cursor += 1;
    }
    items.push(<li key={nextKey(context, "li")}>{itemChildren}</li>);
  }

  if (marker.ordered) {
    return {
      node: (
        <ol key={nextKey(context, "ol")} start={marker.startNumber === 1 ? undefined : marker.startNumber}>
          {items}
        </ol>
      ),
      nextIndex: cursor,
    };
  }
  return { node: <ul key={nextKey(context, "ul")}>{items}</ul>, nextIndex: cursor };
}

export function renderSafeMarkdown(source: string): ReactNode[] {
  const lines = splitSourceLines(source);
  const context: RenderContext = {
    source,
    budget: { blocks: 0, inlineTokens: 0, listItems: 0, tableCells: 0, exhaustedAt: null },
    key: 0,
  };
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length && context.budget.exhaustedAt === null) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    if (!claimBlock(context, line.start)) {
      break;
    }

    const fence = readFence(line);
    if (fence !== null) {
      let closingIndex = index + 1;
      while (closingIndex < lines.length) {
        const candidate = lines[closingIndex];
        if (candidate !== undefined && isClosingFence(candidate, fence)) {
          break;
        }
        closingIndex += 1;
      }
      const contentStart = line.nextStart;
      const closingLine = lines[closingIndex];
      const contentEnd = closingLine === undefined ? source.length : closingLine.start;
      const code = source.slice(contentStart, contentEnd).replace(/\r?\n$/u, "");
      const codeClass = fence.language === null ? undefined : `language-${fence.language}`;
      nodes.push(
        <pre aria-label="Scrollable code block" className="md-code-block" key={nextKey(context, "pre")} tabIndex={0}>
          <code className={codeClass}>{code}</code>
        </pre>,
      );
      index = closingLine === undefined ? lines.length : closingIndex + 1;
      continue;
    }

    const level = headingLevel(line);
    if (level > 0) {
      const part = headingContent(line, level);
      const children = parseInline(part.text, part.start, context);
      switch (level) {
        case 1:
          nodes.push(<h1 key={nextKey(context, "h1")}>{children}</h1>);
          break;
        case 2:
          nodes.push(<h2 key={nextKey(context, "h2")}>{children}</h2>);
          break;
        case 3:
          nodes.push(<h3 key={nextKey(context, "h3")}>{children}</h3>);
          break;
        case 4:
          nodes.push(<h4 key={nextKey(context, "h4")}>{children}</h4>);
          break;
        case 5:
          nodes.push(<h5 key={nextKey(context, "h5")}>{children}</h5>);
          break;
        default:
          nodes.push(<h6 key={nextKey(context, "h6")}>{children}</h6>);
      }
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      nodes.push(<hr key={nextKey(context, "hr")} />);
      index += 1;
      continue;
    }

    const blockquote = readBlockquotePart(line);
    if (blockquote !== null) {
      const quoteChildren: ReactNode[] = [];
      let cursor = index;
      while (cursor < lines.length && context.budget.exhaustedAt === null) {
        const quoteLine = lines[cursor];
        if (quoteLine === undefined) {
          break;
        }
        const quotePart = readBlockquotePart(quoteLine);
        if (quotePart === null) {
          break;
        }
        if (quoteChildren.length > 0) {
          quoteChildren.push(<br key={nextKey(context, "quote-break")} />);
        }
        quoteChildren.push(...parseInline(quotePart.text, quotePart.start, context));
        cursor += 1;
      }
      nodes.push(<blockquote key={nextKey(context, "blockquote")}>{quoteChildren}</blockquote>);
      index = cursor;
      continue;
    }

    const listMarker = readListMarker(line);
    if (listMarker !== null) {
      const list = renderList(lines, index, listMarker, context);
      nodes.push(list.node);
      index = list.nextIndex;
      continue;
    }

    const table = readTable(lines, index);
    if (table !== null) {
      const tableNode = renderTable(table, line.start, context);
      if (tableNode !== null) {
        nodes.push(tableNode);
      }
      index = table.nextIndex;
      continue;
    }

    let paragraphEnd = index + 1;
    while (paragraphEnd < lines.length && !isPotentialBlockStart(lines, paragraphEnd)) {
      paragraphEnd += 1;
    }
    const lastLine = lines[paragraphEnd - 1] ?? line;
    const paragraphText = source.slice(line.start, lastLine.end);
    nodes.push(<p key={nextKey(context, "paragraph")}>{parseInline(paragraphText, line.start, context)}</p>);
    index = paragraphEnd;
  }

  if (context.budget.exhaustedAt !== null) {
    nodes.push(
      <pre
        aria-label="Unparsed Markdown remainder"
        className="md-budget-remainder"
        data-markdown-budget-exhausted="true"
        key={nextKey(context, "remainder")}
      >
        {source.slice(context.budget.exhaustedAt)}
      </pre>,
    );
  }

  return nodes;
}
