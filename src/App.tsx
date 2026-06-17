import { useMemo, useState, type CSSProperties } from 'react'
import { Chess, type PieceSymbol, type Square } from 'chess.js'
import { parse } from '@mliebelt/pgn-parser'
import './App.css'

type Side = 'w' | 'b'
type Orientation = 'white' | 'black'
type DisplayMode = 'all' | 'selected'
type HighlightSideFilter = 'turn' | 'white' | 'black'
type ViewMode = 'safety' | 'control'
type ControlSideFilter = 'both' | 'white' | 'black'
type MoveCategory = 'very-safe' | 'safe' | 'neutral' | 'risky' | 'dangerous'

type ParsedMove = {
  notation?: { notation?: string }
  variations?: ParsedMove[][]
}

type ParsedGame = {
  tags?: { FEN?: string }
  moves?: ParsedMove[]
}

type VerboseMove = {
  from: Square
  to: Square
  san: string
  piece: PieceSymbol
  captured?: PieceSymbol
  promotion?: PieceSymbol
}

type TreeNode = {
  id: string
  parentId: string | null
  children: string[]
  san: string | null
  fen: string
  ply: number
  isMainline: boolean
}

type MoveTree = {
  rootId: string
  nodes: Record<string, TreeNode>
  mainlineByPly: Record<number, string>
  maxMainlinePly: number
}

type HeatEntry = {
  square: Square
  move: string
  score: number
  category: MoveCategory
}

type OverlayEntry = {
  style: CSSProperties
  tooltip: string
}

const CONTROL_OVERLAY_BASE: CSSProperties = {
  width: '100%',
  height: '100%',
  left: '0',
  top: '0',
  transform: 'none',
  borderRadius: 0,
  WebkitMaskImage: 'none',
  maskImage: 'none',
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

const PIECE_SYMBOL: Record<Side, Record<PieceSymbol, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
}

const CATEGORY_COLOR: Record<MoveCategory, string> = {
  'very-safe': 'rgb(45, 150, 80)',
  safe: 'rgb(115, 185, 88)',
  neutral: 'rgba(237, 204, 102, 0.46)',
  risky: 'rgba(237, 150, 79, 0.48)',
  dangerous: 'rgb(200, 46, 40)',
}

const DEFAULT_PGN = `[Event "Third Rosenwald Trophy"]
[Site "New York, USA"]
[Date "1956.10.17"]
[Round "8"]
[White "Donald Byrne"]
[Black "Robert James Fischer"]
[Result "0-1"]

1. Nf3 Nf6
2. c4 g6
3. Nc3 Bg7
4. d4 O-O
5. Bf4 d5
6. Qb3 dxc4
7. Qxc4 c6
8. e4 Nbd7
9. Rd1 Nb6
10. Qc5 Bg4
11. Bg5 Na4
12. Qa3 Nxc3
13. bxc3 Nxe4
14. Bxe7 Qb6
15. Bc4 Nxc3
16. Bc5 Rfe8+
17. Kf1 Be6
18. Bxb6 Bxc4+
19. Kg1 Ne2+
20. Kf1 Nxd4+
21. Kg1 Ne2+
22. Kf1 Nc3+
23. Kg1 axb6
24. Qb4 Ra4
25. Qxb6 Nxd1
26. h3 Rxa2
27. Kh2 Nxf2
28. Re1 Rxe1
29. Qd8+ Bf8
30. Nxe1 Bd5
31. Nf3 Ne4
32. Qb8 b5
33. h4 h5
34. Ne5 Kg7
35. Kg1 Bc5+
36. Kf1 Ng3+
37. Ke1 Bb4+
38. Kd1 Bb3+
39. Kc1 Ne2+
40. Kb1 Nc3+
41. Kc1 Rc2#
  0-1`

function opposite(side: Side): Side {
  return side === 'w' ? 'b' : 'w'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sanitizeSan(san: string): string {
  return san.replace(/[!?]+$/g, '')
}

function categoryForScore(score: number): MoveCategory {
  if (score >= 85) return 'very-safe'
  if (score >= 70) return 'safe'
  if (score >= 50) return 'neutral'
  if (score >= 30) return 'risky'
  return 'dangerous'
}

function squareToCoord(square: Square): [number, number] {
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1]
}

function coordToSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
  return `${String.fromCharCode(97 + file)}${rank + 1}` as Square
}

function isPathClear(chess: Chess, from: Square, to: Square): boolean {
  const [fromFile, fromRank] = squareToCoord(from)
  const [toFile, toRank] = squareToCoord(to)
  const stepFile = Math.sign(toFile - fromFile)
  const stepRank = Math.sign(toRank - fromRank)

  let file = fromFile + stepFile
  let rank = fromRank + stepRank

  while (file !== toFile || rank !== toRank) {
    const sq = coordToSquare(file, rank)
    if (sq && chess.get(sq)) return false
    file += stepFile
    rank += stepRank
  }

  return true
}

function pieceAttacksSquare(chess: Chess, from: Square, to: Square): boolean {
  if (from === to) return false

  const piece = chess.get(from)
  if (!piece) return false

  const [fromFile, fromRank] = squareToCoord(from)
  const [toFile, toRank] = squareToCoord(to)
  const fileDelta = toFile - fromFile
  const rankDelta = toRank - fromRank
  const absFile = Math.abs(fileDelta)
  const absRank = Math.abs(rankDelta)

  if (piece.type === 'p') {
    const direction = piece.color === 'w' ? 1 : -1
    return rankDelta === direction && absFile === 1
  }

  if (piece.type === 'n') {
    return (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1)
  }

  if (piece.type === 'k') {
    return absFile <= 1 && absRank <= 1
  }

  if (piece.type === 'b') {
    return absFile === absRank && isPathClear(chess, from, to)
  }

  if (piece.type === 'r') {
    return (absFile === 0 || absRank === 0) && isPathClear(chess, from, to)
  }

  return (
    (absFile === absRank || absFile === 0 || absRank === 0) &&
    isPathClear(chess, from, to)
  )
}

function countAttackers(chess: Chess, target: Square, side: Side): number {
  let total = 0

  for (const file of FILES) {
    for (const rank of RANKS) {
      const from = `${file}${rank}` as Square
      const piece = chess.get(from)
      if (!piece || piece.color !== side) continue
      if (pieceAttacksSquare(chess, from, target)) total += 1
    }
  }

  return total
}

function canForceSquarePossession(
  board: Chess,
  destination: Square,
  targetSide: Side,
  memo: Map<string, boolean>,
): boolean {
  const key = `${board.fen()}|${destination}|${targetSide}`
  const cached = memo.get(key)
  if (cached !== undefined) return cached

  const sideToMove = board.turn() as Side
  const captures = (board.moves({ verbose: true }) as unknown as VerboseMove[])
    .filter((move) => move.to === destination && !!move.captured)

  if (captures.length === 0) {
    const occupier = board.get(destination)
    const result = !!occupier && occupier.color === targetSide
    memo.set(key, result)
    return result
  }

  const result =
    sideToMove === targetSide
      ? captures.some((capture) => {
          const next = new Chess(board.fen())
          next.move({ from: capture.from, to: capture.to, promotion: capture.promotion })
          return canForceSquarePossession(next, destination, targetSide, memo)
        })
      : captures.every((capture) => {
          const next = new Chess(board.fen())
          next.move({ from: capture.from, to: capture.to, promotion: capture.promotion })
          return canForceSquarePossession(next, destination, targetSide, memo)
        })

  memo.set(key, result)
  return result
}

function immediateExchangeScore(
  afterMove: Chess,
  destination: Square,
  mover: Side,
): { score: number; forcedDangerous: boolean } {
  const enemy = opposite(mover)
  const enemyCaptures = (afterMove.moves({ verbose: true }) as unknown as VerboseMove[])
    .filter((move) => move.to === destination && !!move.captured)

  if (enemyCaptures.length === 0) {
    return { score: 94, forcedDangerous: false }
  }

  const memo = new Map<string, boolean>()
  if (canForceSquarePossession(new Chess(afterMove.fen()), destination, enemy, memo)) {
    return { score: 8, forcedDangerous: true }
  }

  if (canForceSquarePossession(new Chess(afterMove.fen()), destination, mover, memo)) {
    return { score: 86, forcedDangerous: false }
  }

  return { score: 56, forcedDangerous: false }
}

function evaluateMoveSafety(fen: string, move: VerboseMove): number {
  const beforeBoard = new Chess(fen)
  const mover = beforeBoard.turn() as Side

  const played = beforeBoard.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  })

  if (!played) return 0

  const destination = move.to
  const enemy = opposite(mover)

  const attackers = countAttackers(beforeBoard, destination, enemy)
  const defenders = countAttackers(beforeBoard, destination, mover)

  const exchange = immediateExchangeScore(beforeBoard, destination, mover)
  let score = exchange.score

  if (!exchange.forcedDangerous) {
    score += (defenders - attackers) * 3
  } else {
    score = Math.min(score, 20)
  }

  return Math.round(clamp(score, 0, 100))
}

function controlOpacity(count: number): number {
  return clamp(0.35 + count * 0.17, 0.35, 0.98)
}

const WHITE_CONTROL_COLOR = '14, 132, 255'
const BLACK_CONTROL_COLOR = '255, 138, 0'

function createControlOverlay(
  score: number,
  movingSide: Side,
  movingAttacks: number,
  nonMovingAttacks: number,
  filter: ControlSideFilter,
): OverlayEntry | null {
  if (movingAttacks === 0 && nonMovingAttacks === 0) return null

  const controller: Side = score >= 0 ? opposite(movingSide) : movingSide
  if (filter === 'white' && controller !== 'w') return null
  if (filter === 'black' && controller !== 'b') return null

  const intensity = Math.abs(score)
  const color = controller === 'w' ? WHITE_CONTROL_COLOR : BLACK_CONTROL_COLOR
  const label = controller === 'w' ? 'White' : 'Black'

  return {
    style: {
      ...CONTROL_OVERLAY_BASE,
      background:
        `radial-gradient(circle at 50% 50%, rgba(${color}, ${controlOpacity(Math.max(1, intensity))}) 0%, ` +
        `rgba(${color}, ${controlOpacity(Math.max(1, intensity)) * 0.64}) 58%, rgba(${color}, 0) 100%)`,
      opacity: 1,
    },
    tooltip:
      `${label} control | score=${score} | moving attacks: ${movingAttacks} | non-moving attacks: ${nonMovingAttacks}`,
  }
}

function createEmptyTree(startFen?: string): MoveTree {
  const rootFen = startFen ? new Chess(startFen).fen() : new Chess().fen()

  return {
    rootId: 'root',
    nodes: {
      root: {
        id: 'root',
        parentId: null,
        children: [],
        san: null,
        fen: rootFen,
        ply: 0,
        isMainline: true,
      },
    },
    mainlineByPly: { 0: 'root' },
    maxMainlinePly: 0,
  }
}

function buildTreeFromPgn(pgnText: string): MoveTree {
  const parsed = parse(pgnText, { startRule: 'games' }) as ParsedGame[]
  const game = parsed[0]
  const tree = createEmptyTree(game?.tags?.FEN)
  let idCounter = 1

  const addLine = (
    moves: ParsedMove[] | undefined,
    parentId: string,
    isMainline: boolean,
  ): void => {
    let cursor = parentId

    for (const parsedMove of moves ?? []) {
      const sanText = parsedMove.notation?.notation
      if (!sanText) continue

      const branchParent = cursor
      const board = new Chess(tree.nodes[cursor].fen)
      const played = board.move(sanitizeSan(sanText))
      if (!played) continue

      const id = `n${idCounter}`
      idCounter += 1

      const node: TreeNode = {
        id,
        parentId: cursor,
        children: [],
        san: played.san,
        fen: board.fen(),
        ply: tree.nodes[cursor].ply + 1,
        isMainline,
      }

      tree.nodes[id] = node
      tree.nodes[cursor].children.push(id)
      cursor = id

      if (isMainline) {
        tree.mainlineByPly[node.ply] = id
        tree.maxMainlinePly = Math.max(tree.maxMainlinePly, node.ply)
      }

      for (const variation of parsedMove.variations ?? []) {
        if (Array.isArray(variation) && variation.length > 0) {
          addLine(variation, branchParent, false)
        }
      }
    }
  }

  addLine(game?.moves, tree.rootId, true)
  return tree
}

function App() {
  const [pgnInput, setPgnInput] = useState(DEFAULT_PGN)
  const [tree, setTree] = useState<MoveTree>(() => buildTreeFromPgn(DEFAULT_PGN))
  const [currentNodeId, setCurrentNodeId] = useState<string>('root')
  const [orientation, setOrientation] = useState<Orientation>('white')
  const [viewMode, setViewMode] = useState<ViewMode>('safety')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('selected')
  const [highlightSideFilter, setHighlightSideFilter] =
    useState<HighlightSideFilter>('turn')
  const [controlSideFilter, setControlSideFilter] =
    useState<ControlSideFilter>('both')
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const currentNode = tree.nodes[currentNodeId]
  const board = useMemo(() => new Chess(currentNode.fen), [currentNode.fen])
  const sideToMove = board.turn() as Side
  const canGoBack = !!currentNode.parentId
  const canGoForward = currentNode.children.length > 0
  const currentMoveLabel = currentNode.san ?? 'Start position'

  const highlightedSide: Side =
    highlightSideFilter === 'turn'
      ? sideToMove
      : highlightSideFilter === 'white'
        ? 'w'
        : 'b'

  const highlightsEnabled = viewMode === 'safety' && highlightedSide === sideToMove

  const legalMoves = useMemo(() => {
    if (!highlightsEnabled) return []

    const all = board.moves({ verbose: true }) as unknown as VerboseMove[]
    if (displayMode === 'selected' && selectedSquare) {
      return all.filter((move) => move.from === selectedSquare)
    }
    return all
  }, [board, displayMode, selectedSquare, highlightsEnabled])

  const heatBySquare = useMemo(() => {
    const map = new Map<Square, HeatEntry>()

    for (const move of legalMoves) {
      const score = evaluateMoveSafety(currentNode.fen, move)
      const entry: HeatEntry = {
        square: move.to,
        move: `${move.from}-${move.to}`,
        score,
        category: categoryForScore(score),
      }

      const existing = map.get(move.to)
      if (!existing || entry.score > existing.score) {
        map.set(move.to, entry)
      }
    }

    return map
  }, [legalMoves, currentNode.fen])

  const controlBySquare = useMemo(() => {
    const map = new Map<Square, OverlayEntry>()
    const movingSide = sideToMove
    const otherSide = opposite(movingSide)

    for (const file of FILES) {
      for (const rank of RANKS) {
        const square = `${file}${rank}` as Square
        const movingAttacks = countAttackers(board, square, movingSide)
        const nonMovingAttacks = countAttackers(board, square, otherSide)
        if (movingAttacks === 0 && nonMovingAttacks === 0) continue
        const score = nonMovingAttacks - movingAttacks
        const overlay = createControlOverlay(
          score,
          movingSide,
          movingAttacks,
          nonMovingAttacks,
          controlSideFilter,
        )
        if (overlay) map.set(square, overlay)
      }
    }

    return map
  }, [board, controlSideFilter, sideToMove])

  const orderedRanks = orientation === 'white' ? [...RANKS].reverse() : [...RANKS]
  const orderedFiles = orientation === 'white' ? [...FILES] : [...FILES].reverse()

  const currentPath = useMemo(() => {
    const result: string[] = []
    let cursor: TreeNode | undefined = currentNode

    while (cursor && cursor.parentId) {
      if (cursor.san) result.push(cursor.san)
      cursor = tree.nodes[cursor.parentId]
    }

    return result.reverse().join(' ')
  }, [currentNode, tree.nodes])

  function handleLoadPgn(): void {
    try {
      const nextTree = buildTreeFromPgn(pgnInput)
      setTree(nextTree)
      setCurrentNodeId(nextTree.rootId)
      setSelectedSquare(null)
      setErrorMessage('')
    } catch {
      setErrorMessage('Could not parse PGN. Please check PGN formatting and SAN notation.')
    }
  }

  function goStart(): void {
    setCurrentNodeId(tree.rootId)
    setSelectedSquare(null)
  }

  function goEnd(): void {
    setCurrentNodeId(tree.mainlineByPly[tree.maxMainlinePly])
    setSelectedSquare(null)
  }

  function goPrev(): void {
    if (!currentNode.parentId) return
    setCurrentNodeId(currentNode.parentId)
    setSelectedSquare(null)
  }

  function goNext(): void {
    if (currentNode.children.length === 0) return
    setCurrentNodeId(currentNode.children[0])
    setSelectedSquare(null)
  }

  function returnMainline(): void {
    if (currentNode.isMainline) return

    let ply = currentNode.ply
    while (ply >= 0) {
      const mainNodeId = tree.mainlineByPly[ply]
      if (mainNodeId) {
        setCurrentNodeId(mainNodeId)
        setSelectedSquare(null)
        return
      }
      ply -= 1
    }
  }

  function onSquareClick(square: Square): void {
    if (viewMode !== 'safety' || displayMode !== 'selected') return
    if (!highlightsEnabled) {
      setSelectedSquare(null)
      return
    }

    const piece = board.get(square)
    if (piece && piece.color === sideToMove) {
      setSelectedSquare((prev) => (prev === square ? null : square))
      return
    }

    setSelectedSquare(null)
  }

  return (
    <main className="app-shell">
      <section className="left-panel">
        <h1>Chess Safety Heat Map</h1>
        <p className="subtitle">
          Switch between move safety and board control overlays.
        </p>

        <div className="control-group">
          <div className="control-heading">
            <label className="control-label" htmlFor="pgn-input">
              PGN
            </label>
            <button className="primary" type="button" onClick={handleLoadPgn}>
              Load game
            </button>
          </div>
          <textarea
            id="pgn-input"
            className="pgn-input"
            value={pgnInput}
            onChange={(event) => setPgnInput(event.target.value)}
            rows={8}
            spellCheck={false}
          />
        </div>

        <div className="control-group">
          <div className="control-heading">
            <span className="control-label">Position</span>
            <span className="control-value">{currentMoveLabel}</span>
          </div>
          <div className="move-controls" aria-label="Move navigation">
            <button
              type="button"
              onClick={goStart}
              disabled={currentNode.ply === 0}
              title="Start position"
            >
              |&lt;
              <span>Start</span>
            </button>
            <button
              type="button"
              onClick={goPrev}
              disabled={!canGoBack}
              title="Previous move"
            >
              &lt;
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoForward}
              title="Next move"
            >
              <span>Next</span>
              &gt;
            </button>
            <button
              type="button"
              onClick={goEnd}
              disabled={currentNode.ply === tree.maxMainlinePly}
              title="Final main-line move"
            >
              <span>End</span>
              &gt;|
            </button>
          </div>
        </div>

        <div className="control-group compact">
          <div className="control-heading">
            <span className="control-label">View</span>
          </div>
          <div className="segmented-control" role="group" aria-label="Overlay view">
            <button
              className={viewMode === 'safety' ? 'active' : ''}
              type="button"
              aria-pressed={viewMode === 'safety'}
              onClick={() => {
                setViewMode('safety')
                setSelectedSquare(null)
              }}
            >
              Move safety
            </button>
            <button
              className={viewMode === 'control' ? 'active' : ''}
              type="button"
              aria-pressed={viewMode === 'control'}
              onClick={() => {
                setViewMode('control')
                setSelectedSquare(null)
              }}
            >
              Board control
            </button>
          </div>
        </div>

        {viewMode === 'safety' && (
          <div className="control-group compact">
            <div className="control-heading">
              <span className="control-label">Safety overlay</span>
            </div>
            <div className="segmented-control" role="group" aria-label="Safety side">
              <button
                className={highlightSideFilter === 'turn' ? 'active' : ''}
                type="button"
                aria-pressed={highlightSideFilter === 'turn'}
                onClick={() => {
                  setHighlightSideFilter('turn')
                  setSelectedSquare(null)
                }}
              >
                To move
              </button>
              <button
                className={highlightSideFilter === 'white' ? 'active' : ''}
                type="button"
                aria-pressed={highlightSideFilter === 'white'}
                onClick={() => {
                  setHighlightSideFilter('white')
                  setSelectedSquare(null)
                }}
              >
                White
              </button>
              <button
                className={highlightSideFilter === 'black' ? 'active' : ''}
                type="button"
                aria-pressed={highlightSideFilter === 'black'}
                onClick={() => {
                  setHighlightSideFilter('black')
                  setSelectedSquare(null)
                }}
              >
                Black
              </button>
            </div>

            <div className="segmented-control secondary" role="group" aria-label="Move scope">
              <button
                className={displayMode === 'all' ? 'active' : ''}
                type="button"
                aria-pressed={displayMode === 'all'}
                onClick={() => {
                  setDisplayMode('all')
                  setSelectedSquare(null)
                }}
              >
                All moves
              </button>
              <button
                className={displayMode === 'selected' ? 'active' : ''}
                type="button"
                aria-pressed={displayMode === 'selected'}
                onClick={() => setDisplayMode('selected')}
              >
                Pick a piece
              </button>
            </div>
          </div>
        )}

        {viewMode === 'control' && (
          <div className="control-group compact">
            <div className="control-heading">
              <span className="control-label">Board control</span>
            </div>
            <div className="segmented-control" role="group" aria-label="Control side">
              <button
                className={controlSideFilter === 'both' ? 'active' : ''}
                type="button"
                aria-pressed={controlSideFilter === 'both'}
                onClick={() => setControlSideFilter('both')}
              >
                Both
              </button>
              <button
                className={controlSideFilter === 'white' ? 'active' : ''}
                type="button"
                aria-pressed={controlSideFilter === 'white'}
                onClick={() => setControlSideFilter('white')}
              >
                White
              </button>
              <button
                className={controlSideFilter === 'black' ? 'active' : ''}
                type="button"
                aria-pressed={controlSideFilter === 'black'}
                onClick={() => setControlSideFilter('black')}
              >
                Black
              </button>
            </div>
          </div>
        )}

        <div className="control-group compact">
          <div className="control-heading">
            <span className="control-label">Board</span>
          </div>
          <div className="segmented-control" role="group" aria-label="Board orientation">
            <button
              className={orientation === 'white' ? 'active' : ''}
              type="button"
              aria-pressed={orientation === 'white'}
              onClick={() => setOrientation('white')}
            >
              White bottom
            </button>
            <button
              className={orientation === 'black' ? 'active' : ''}
              type="button"
              aria-pressed={orientation === 'black'}
              onClick={() => setOrientation('black')}
            >
              Black bottom
            </button>
          </div>
        </div>

        <div className="meta-card">
          <p>
            <strong>Side to move:</strong> {sideToMove === 'w' ? 'White' : 'Black'}
          </p>
          <p>
            <strong>View mode:</strong> {viewMode === 'safety' ? 'Move safety' : 'Space control'}
          </p>
          <p>
            <strong>Highlight side:</strong>{' '}
            {viewMode === 'safety'
              ? highlightSideFilter === 'turn'
                ? 'Side to move'
                : highlightSideFilter === 'white'
                  ? 'White only'
                  : 'Black only'
              : controlSideFilter === 'both'
                ? 'Both'
                : controlSideFilter === 'white'
                  ? 'White only'
                  : 'Black only'}
          </p>
          <p>
            <strong>Current move:</strong> {currentNode.san ?? 'Start position'}
          </p>
          <p>
            <strong>Current line:</strong> {currentPath || 'Main line start'}
          </p>
          {viewMode === 'safety' && (
            <p>
              <strong>Selected piece:</strong> {selectedSquare ?? 'None'}
            </p>
          )}
          {viewMode === 'safety' && !highlightsEnabled && (
            <p>
              <strong>Highlights:</strong> Off this ply (filtered to the other side)
            </p>
          )}
        </div>

        <div className="variation-card">
          <p className="variation-title">Branches</p>
          <div className="variation-list">
            {currentNode.children.length === 0 && <span>No continuations from here.</span>}
            {currentNode.children.map((childId, index) => {
              const child = tree.nodes[childId]
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => {
                    setCurrentNodeId(child.id)
                    setSelectedSquare(null)
                  }}
                >
                  {child.isMainline ? 'Main line' : `Variation ${index + 1}`}: {child.san}
                </button>
              )
            })}
          </div>
          <button type="button" disabled={currentNode.isMainline} onClick={returnMainline}>
            Return to main line
          </button>
        </div>

        <div className="legend">
          <p>Legend</p>
          {viewMode === 'safety' && (
            <ul>
              <li>
                <span style={{ backgroundColor: CATEGORY_COLOR['very-safe'] }} /> Green: Safe
              </li>
              <li>
                <span style={{ backgroundColor: CATEGORY_COLOR.safe }} /> Light green: Mostly safe
              </li>
              <li>
                <span style={{ backgroundColor: CATEGORY_COLOR.neutral }} /> Yellow: Neutral
              </li>
              <li>
                <span style={{ backgroundColor: CATEGORY_COLOR.risky }} /> Orange: Risky
              </li>
              <li>
                <span style={{ backgroundColor: CATEGORY_COLOR.dangerous }} /> Red: Dangerous
              </li>
            </ul>
          )}

          {viewMode === 'control' && (
            <ul>
              <li>
                <span style={{ backgroundColor: 'rgb(14, 132, 255)' }} /> White ultimate control
              </li>
              <li>
                <span style={{ backgroundColor: 'rgb(255, 138, 0)' }} /> Black ultimate control
              </li>
            </ul>
          )}
        </div>

        {errorMessage && <p className="error">{errorMessage}</p>}
      </section>

      <section className="board-panel">
        <div className="board-frame">
          <div className="file-labels top" aria-hidden="true">
            {orderedFiles.map((file) => (
              <span key={`top-${file}`}>{file}</span>
            ))}
          </div>

          <div className="board-middle">
            <div className="rank-labels" aria-hidden="true">
              {orderedRanks.map((rank) => (
                <span key={`left-${rank}`}>{rank}</span>
              ))}
            </div>

            <div className="board-grid" role="grid" aria-label="Chessboard">
              {orderedRanks.map((rank) =>
                orderedFiles.map((file) => {
                  const square = `${file}${rank}` as Square
                  const piece = board.get(square)
                  const heat = heatBySquare.get(square)
                  const controlOverlay = controlBySquare.get(square)
                  const isLight = (FILES.indexOf(file) + Number(rank)) % 2 === 0
                  const isSelected = selectedSquare === square

                  const overlay: OverlayEntry | null =
                    viewMode === 'safety'
                      ? heat
                        ? {
                            style: { backgroundColor: CATEGORY_COLOR[heat.category] },
                            tooltip: `${heat.move} | score ${heat.score}`,
                          }
                        : null
                      : controlOverlay ?? null

                  return (
                    <button
                      key={square}
                      type="button"
                      className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''}`}
                      onClick={() => onSquareClick(square)}
                      title={overlay ? overlay.tooltip : square.toUpperCase()}
                    >
                      {overlay && <span className="heat" style={overlay.style} />}
                      <span className="piece">
                        {piece ? PIECE_SYMBOL[piece.color][piece.type] : ''}
                      </span>
                    </button>
                  )
                }),
              )}
            </div>

            <div className="rank-labels" aria-hidden="true">
              {orderedRanks.map((rank) => (
                <span key={`right-${rank}`}>{rank}</span>
              ))}
            </div>
          </div>

          <div className="file-labels bottom" aria-hidden="true">
            {orderedFiles.map((file) => (
              <span key={`bottom-${file}`}>{file}</span>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
