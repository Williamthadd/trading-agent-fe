import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

export const PANEL_LAYOUT_STORAGE_KEY = 'tradingagents.web.panelLayout.v1'

type ResizeSide = 'input' | 'archive'

interface PanelWidths {
  input: number
  archive: number
}

interface DragState {
  side: ResizeSide
  pointerId: number
  startX: number
  startWidth: number
}

interface ResizablePanelGridProps {
  children: ReactNode
}

interface PanelGridStyle extends CSSProperties {
  '--input-panel-width': string
  '--archive-panel-width': string
}

interface ResizeHandleProps {
  side: ResizeSide
  active: boolean
  value: number
  valueText: string
  onPointerDown: (side: ResizeSide, event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerEnd: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (side: ResizeSide, event: KeyboardEvent<HTMLDivElement>) => void
  onReset: (side: ResizeSide) => void
}

const GRID_HORIZONTAL_PADDING = 14
const RESIZER_WIDTH = 9
const STACKED_BREAKPOINT = 860
const TWO_COLUMN_BREAKPOINT = 1180
const MIN_INPUT_WIDTH = 270
const MIN_DESK_WIDTH = 420
const MIN_TWO_COLUMN_DESK_WIDTH = 360
const MIN_ARCHIVE_WIDTH = 245
const DEFAULT_ARCHIVE_WIDTH = 290

function defaultWidths(): PanelWidths {
  return {
    input: typeof window !== 'undefined' && window.innerWidth <= TWO_COLUMN_BREAKPOINT ? 285 : 310,
    archive: DEFAULT_ARCHIVE_WIDTH,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function readStoredWidths(): PanelWidths {
  const fallback = defaultWidths()
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY) ?? '') as Partial<PanelWidths>
    return {
      input: Number.isFinite(parsed.input) ? clamp(Number(parsed.input), MIN_INPUT_WIDTH, 2_000) : fallback.input,
      archive: Number.isFinite(parsed.archive) ? clamp(Number(parsed.archive), MIN_ARCHIVE_WIDTH, 2_000) : fallback.archive,
    }
  } catch {
    return fallback
  }
}

function panelSpace(containerWidth: number, viewportWidth: number): number {
  const handleCount = viewportWidth > TWO_COLUMN_BREAKPOINT ? 2 : 1
  return Math.max(0, containerWidth - GRID_HORIZONTAL_PADDING - handleCount * RESIZER_WIDTH)
}

function constrainWidths(current: PanelWidths, containerWidth: number, viewportWidth: number): PanelWidths {
  if (viewportWidth <= STACKED_BREAKPOINT || containerWidth <= 0) return current
  const available = panelSpace(containerWidth, viewportWidth)

  if (viewportWidth <= TWO_COLUMN_BREAKPOINT) {
    return {
      input: Math.round(clamp(current.input, MIN_INPUT_WIDTH, available - MIN_TWO_COLUMN_DESK_WIDTH)),
      archive: Math.max(MIN_ARCHIVE_WIDTH, current.archive),
    }
  }

  const sideBudget = Math.max(MIN_INPUT_WIDTH + MIN_ARCHIVE_WIDTH, available - MIN_DESK_WIDTH)
  const input = Math.max(MIN_INPUT_WIDTH, current.input)
  const archive = Math.max(MIN_ARCHIVE_WIDTH, current.archive)
  const extraInput = input - MIN_INPUT_WIDTH
  const extraArchive = archive - MIN_ARCHIVE_WIDTH
  const extraTotal = extraInput + extraArchive
  const extraBudget = Math.max(0, sideBudget - MIN_INPUT_WIDTH - MIN_ARCHIVE_WIDTH)

  if (input + archive <= sideBudget || extraTotal === 0) {
    return { input: Math.round(input), archive: Math.round(archive) }
  }

  const scale = extraBudget / extraTotal
  return {
    input: Math.round(MIN_INPUT_WIDTH + extraInput * scale),
    archive: Math.round(MIN_ARCHIVE_WIDTH + extraArchive * scale),
  }
}

function ResizeHandle({
  side,
  active,
  value,
  valueText,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onKeyDown,
  onReset,
}: ResizeHandleProps) {
  const inputSide = side === 'input'
  const label = inputSide
    ? 'Resize Input and Intelligence Desk panels'
    : 'Resize Intelligence Desk and Archive panels'

  return (
    <div
      className={`panel-resizer panel-resizer--${side}${active ? ' is-active' : ''}`}
      role="separator"
      aria-label={label}
      aria-controls={inputSide ? 'input-panel intelligence-panel' : 'intelligence-panel archive-panel'}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={valueText}
      tabIndex={0}
      title="Drag or use Left/Right arrows. Press Enter or double-click to reset."
      onPointerDown={(event) => onPointerDown(side, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={(event) => onKeyDown(side, event)}
      onDoubleClick={() => onReset(side)}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />
    </div>
  )
}

export function ResizablePanelGrid({ children }: ResizablePanelGridProps) {
  const panels = Children.toArray(children)
  const gridRef = useRef<HTMLElement>(null)
  const drag = useRef<DragState | null>(null)
  const [widths, setWidths] = useState<PanelWidths>(readStoredWidths)
  const [activeSide, setActiveSide] = useState<ResizeSide | null>(null)
  const [containerWidth, setContainerWidth] = useState(
    typeof window === 'undefined' ? 1 : window.innerWidth,
  )

  const gridMetrics = useCallback(() => ({
    containerWidth: gridRef.current?.clientWidth ?? 0,
    viewportWidth: window.innerWidth,
  }), [])

  const setPanelWidth = useCallback((side: ResizeSide, requestedWidth: number) => {
    setWidths((current) => {
      const { containerWidth, viewportWidth } = gridMetrics()
      if (viewportWidth <= STACKED_BREAKPOINT || containerWidth <= 0) return current
      const available = panelSpace(containerWidth, viewportWidth)
      const minimum = side === 'input' ? MIN_INPUT_WIDTH : MIN_ARCHIVE_WIDTH
      const maximum = viewportWidth <= TWO_COLUMN_BREAKPOINT
        ? available - MIN_TWO_COLUMN_DESK_WIDTH
        : available - (side === 'input' ? current.archive : current.input) - MIN_DESK_WIDTH
      const nextValue = Math.round(clamp(requestedWidth, minimum, maximum))
      if (current[side] === nextValue) return current
      return { ...current, [side]: nextValue }
    })
  }, [gridMetrics])

  const resetPanel = useCallback((side: ResizeSide) => {
    setPanelWidth(side, defaultWidths()[side])
  }, [setPanelWidth])

  const startResize = useCallback((side: ResizeSide, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widths[side],
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveSide(side)
    document.documentElement.classList.add('is-panel-resizing')
  }, [widths])

  const moveResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return
    const movement = event.clientX - currentDrag.startX
    setPanelWidth(
      currentDrag.side,
      currentDrag.startWidth + (currentDrag.side === 'input' ? movement : -movement),
    )
  }, [setPanelWidth])

  const endResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    setActiveSide(null)
    document.documentElement.classList.remove('is-panel-resizing')
  }, [])

  const resizeWithKeyboard = useCallback((side: ResizeSide, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      resetPanel(side)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const physicalMovement = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 64 : 24)
    const widthMovement = side === 'input' ? physicalMovement : -physicalMovement
    setPanelWidth(side, widths[side] + widthMovement)
  }, [resetPanel, setPanelWidth, widths])

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // Layout persistence is optional when browser storage is unavailable.
    }
  }, [widths])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setContainerWidth(grid.clientWidth)
      setWidths((current) => {
        const next = constrainWidths(current, grid.clientWidth, window.innerWidth)
        return next.input === current.input && next.archive === current.archive ? current : next
      })
    })
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    document.documentElement.classList.remove('is-panel-resizing')
  }, [])

  const inputPosition = Math.round((widths.input / Math.max(containerWidth, 1)) * 100)
  const archivePosition = Math.round(((containerWidth - widths.archive) / Math.max(containerWidth, 1)) * 100)
  const style: PanelGridStyle = {
    '--input-panel-width': `${widths.input}px`,
    '--archive-panel-width': `${widths.archive}px`,
  }

  return (
    <main id="workspace" className="terminal-grid terminal-grid--resizable" tabIndex={-1} ref={gridRef} style={style}>
      {panels[0]}
      <ResizeHandle
        side="input"
        active={activeSide === 'input'}
        value={inputPosition}
        valueText={`Input panel width ${widths.input} pixels`}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerEnd={endResize}
        onKeyDown={resizeWithKeyboard}
        onReset={resetPanel}
      />
      {panels[1]}
      <ResizeHandle
        side="archive"
        active={activeSide === 'archive'}
        value={archivePosition}
        valueText={`Archive panel width ${widths.archive} pixels`}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerEnd={endResize}
        onKeyDown={resizeWithKeyboard}
        onReset={resetPanel}
      />
      {panels[2]}
    </main>
  )
}
