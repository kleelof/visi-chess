from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal

import chess
import chess.pgn
from PIL import Image, ImageColor, ImageDraw, ImageFont

try:
    import imageio.v2 as imageio
    import numpy as np
except ImportError:
    imageio = None
    np = None


SideFilter = Literal['both', 'white', 'black']
MoveColorFilter = Literal['both', 'white', 'black']
Side = Literal['w', 'b']
Controller = Literal['w', 'b', 'tie']

LABEL_COLOR = '#452815'
BORDER_COLOR = '#2e1f11'
BACKGROUND_COLOR = '#f6e4c6'
BOARD_COLOR = '#e6c596'
WHITE_CONTROL_RGB = (242, 242, 242)
BLACK_CONTROL_RGB = (20, 20, 20)
TIE_CONTROL_RGB = (255, 214, 214)
NEUTRAL_CONTROL_RGB = (127, 127, 127)
PIECE_GLYPHS: dict[tuple[bool, int], str] = {
    (chess.WHITE, chess.PAWN): '♙',
    (chess.WHITE, chess.KNIGHT): '♘',
    (chess.WHITE, chess.BISHOP): '♗',
    (chess.WHITE, chess.ROOK): '♖',
    (chess.WHITE, chess.QUEEN): '♕',
    (chess.WHITE, chess.KING): '♔',
    (chess.BLACK, chess.PAWN): '♟',
    (chess.BLACK, chess.KNIGHT): '♞',
    (chess.BLACK, chess.BISHOP): '♝',
    (chess.BLACK, chess.ROOK): '♜',
    (chess.BLACK, chess.QUEEN): '♛',
    (chess.BLACK, chess.KING): '♚',
}


@dataclass(frozen=True)
class FrameState:
    fen: str
    label: str
    moved_by: Side | None
    highlighted_squares: tuple[chess.Square, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Render a PGN mainline into a space-control animation.',
    )
    parser.add_argument('input', type=Path, help='Path to the PGN file.')
    parser.add_argument(
        '-o',
        '--output',
        type=Path,
        help='Output path. Defaults to the input stem with .gif extension.',
    )
    parser.add_argument(
        '--format',
        choices=['gif', 'mp4', 'both'],
        default='gif',
        help='Animation format to write.',
    )
    parser.add_argument(
        '--seconds-per-position',
        type=float,
        default=2.0,
        help='How long each frame should stay on screen.',
    )
    parser.add_argument(
        '--time-per-move',
        type=float,
        help='Alias for --seconds-per-position.',
    )
    parser.add_argument(
        '--fps',
        type=int,
        default=12,
        help='Frames per second for MP4 output.',
    )
    parser.add_argument(
        '--board-size',
        type=int,
        default=960,
        help='Board area in pixels, excluding labels and footer.',
    )
    parser.add_argument(
        '--side-filter',
        choices=['both', 'white', 'black'],
        default='both',
        help='Which side control to render.',
    )
    parser.add_argument(
        '--orientation',
        choices=['white', 'black'],
        default='white',
        help='Board orientation in the output animation.',
    )
    parser.add_argument(
        '--include-initial',
        action='store_true',
        help='Include the starting position before the first move.',
    )
    parser.add_argument(
        '--after-move-color',
        choices=['both', 'white', 'black'],
        default='both',
        help='Keep only positions after this side has moved.',
    )
    return parser.parse_args()


def read_game(path: Path) -> chess.pgn.Game:
    with path.open('r', encoding='utf-8') as handle:
        game = chess.pgn.read_game(handle)

    if game is None:
        raise ValueError(f'No PGN game found in {path}.')

    return game


def collect_positions(
    game: chess.pgn.Game,
    include_initial: bool,
    after_move_color: MoveColorFilter,
) -> list[FrameState]:
    board = game.board()
    positions: list[FrameState] = []

    move_history: list[chess.Square] = []

    if include_initial and after_move_color == 'both':
        positions.append(FrameState(board.fen(), 'Start position', None, ()))

    for index, move in enumerate(game.mainline_moves(), start=1):
        mover_side: Side = 'w' if board.turn == chess.WHITE else 'b'
        mover_color = 'white' if mover_side == 'w' else 'black'
        san = board.san(move)
        move_history.append(move.to_square)
        board.push(move)

        if after_move_color != 'both' and mover_color != after_move_color:
            continue

        if len(move_history) >= 2:
            highlights = (move_history[-1], move_history[-2])
        else:
            highlights = (move_history[-1],)

        positions.append(FrameState(board.fen(), f'{index}. {san}', mover_side, highlights))

    if not positions:
        positions.append(FrameState(board.fen(), 'Start position', None, ()))

    return positions


def square_attack_counts(board: chess.Board) -> dict[chess.Square, tuple[int, int]]:
    counts: dict[chess.Square, tuple[int, int]] = {}
    for square in chess.SQUARES:
        white = len(board.attackers(chess.WHITE, square))
        black = len(board.attackers(chess.BLACK, square))

        counts[square] = (white, black)
    return counts


def ordered_squares(orientation: str) -> Iterable[tuple[int, int, chess.Square, str, str]]:
    files = list(range(8)) if orientation == 'white' else list(range(7, -1, -1))
    ranks = list(range(7, -1, -1)) if orientation == 'white' else list(range(8))

    for row_index, rank in enumerate(ranks):
        for col_index, file_index in enumerate(files):
            square = chess.square(file_index, rank)
            yield row_index, col_index, square, chess.FILE_NAMES[file_index], chess.RANK_NAMES[rank]


def load_text_font(size: int) -> ImageFont.ImageFont:
    preferred_fonts = ['DejaVuSans-Bold.ttf', 'DejaVuSans.ttf', 'Arial.ttf']

    for font_name in preferred_fonts:
        try:
            return ImageFont.truetype(font_name, size)
        except OSError:
            continue

    return ImageFont.load_default()


def load_piece_font(square_size: int) -> ImageFont.ImageFont:
    preferred_fonts = ['DejaVuSans.ttf', 'Arial Unicode.ttf', 'Arial.ttf']
    piece_size = max(18, int(square_size * 0.72))

    for font_name in preferred_fonts:
        try:
            return ImageFont.truetype(font_name, piece_size)
        except OSError:
            continue

    return ImageFont.load_default()


def determine_controller(white_count: int, black_count: int) -> Controller | None:
    if white_count == 0 and black_count == 0:
        return None
    if white_count > black_count:
        return 'w'
    if black_count > white_count:
        return 'b'
    return 'tie'


def display_color(controller: Controller | None, side_filter: SideFilter) -> tuple[int, int, int]:
    if controller is None:
        return NEUTRAL_CONTROL_RGB
    if side_filter == 'white' and controller != 'w':
        return NEUTRAL_CONTROL_RGB
    if side_filter == 'black' and controller != 'b':
        return NEUTRAL_CONTROL_RGB
    if controller == 'tie':
        return TIE_CONTROL_RGB
    return WHITE_CONTROL_RGB if controller == 'w' else BLACK_CONTROL_RGB


def render_frame(
    state: FrameState,
    board_size: int,
    side_filter: SideFilter,
    orientation: str,
) -> Image.Image:
    margin = max(18, board_size // 32)
    footer = max(98, board_size // 6)
    total_width = board_size + margin * 2
    total_height = board_size + margin + footer
    square_size = board_size // 8

    board = chess.Board(state.fen)
    counts = square_attack_counts(board)
    image = Image.new('RGBA', (total_width, total_height), ImageColor.getrgb(BACKGROUND_COLOR))
    draw = ImageDraw.Draw(image)
    footer_font = load_text_font(max(20, board_size // 34))
    stats_font = load_text_font(max(15, board_size // 48))
    piece_font = load_piece_font(square_size)
    white_controlled = 0
    black_controlled = 0

    draw.rounded_rectangle(
        (margin, margin, margin + square_size * 8, margin + square_size * 8),
        radius=max(12, board_size // 36),
        fill=ImageColor.getrgb(BOARD_COLOR),
        outline=ImageColor.getrgb(BORDER_COLOR),
        width=max(1, board_size // 240),
    )

    # Very light grid lines to separate full-fill control squares.
    grid_color = (210, 210, 210)
    for offset in range(1, 8):
        x = margin + offset * square_size
        y = margin + offset * square_size
        draw.line((x, margin, x, margin + square_size * 8), fill=grid_color, width=1)
        draw.line((margin, y, margin + square_size * 8, y), fill=grid_color, width=1)

    highlighted = set(state.highlighted_squares)

    for row_index, col_index, square, _, _ in ordered_squares(orientation):
        x0 = margin + col_index * square_size
        y0 = margin + row_index * square_size
        x1 = x0 + square_size
        y1 = y0 + square_size
        white_count, black_count = counts[square]
        controller = determine_controller(white_count, black_count)
        if controller == 'w':
            white_controlled += 1
        elif controller == 'b':
            black_controlled += 1

        rgb = display_color(controller, side_filter)
        draw.rectangle((x0, y0, x1, y1), fill=rgb)

        piece = board.piece_at(square)
        if piece:
            glyph = PIECE_GLYPHS[(piece.color, piece.piece_type)]
            is_recent = square in highlighted
            piece_fill = '#87d487' if is_recent else ('#f5f5f5' if piece.color == chess.WHITE else '#151515')
            piece_outline = '#151515' if piece.color == chess.WHITE else '#f5f5f5'
            draw.text(
                (x0 + square_size // 2, y0 + square_size // 2),
                glyph,
                fill=piece_fill,
                font=piece_font,
                anchor='mm',
                stroke_width=max(1, square_size // 24),
                stroke_fill=piece_outline,
            )

    white_pct = (white_controlled / 64) * 100
    black_pct = (black_controlled / 64) * 100

    draw.text(
        (total_width // 2, total_height - int(footer * 0.65)),
        state.label,
        fill=LABEL_COLOR,
        anchor='mm',
        font=footer_font,
    )
    draw.text(
        (total_width // 2, total_height - int(footer * 0.28)),
        f'White control: {white_pct:.1f}%   Black control: {black_pct:.1f}%',
        fill=LABEL_COLOR,
        anchor='mm',
        font=stats_font,
    )

    return image


def output_paths(input_path: Path, output: Path | None, format_name: str) -> list[Path]:
    if output is None:
        base = input_path.with_suffix('')
    else:
        base = output.with_suffix('') if format_name == 'both' else output.with_suffix('')

    if format_name == 'gif':
        return [base.with_suffix('.gif')]
    if format_name == 'mp4':
        return [base.with_suffix('.mp4')]
    return [base.with_suffix('.gif'), base.with_suffix('.mp4')]


def save_gif(frames: list[Image.Image], path: Path, duration_seconds: float) -> None:
    palette_frames = [
        frame.convert('P', palette=Image.Palette.ADAPTIVE, colors=256, dither=Image.Dither.NONE)
        for frame in frames
    ]
    palette_frames[0].save(
        path,
        save_all=True,
        append_images=palette_frames[1:],
        duration=int(duration_seconds * 1000),
        loop=0,
        disposal=2,
        optimize=False,
    )


def save_mp4(frames: list[Image.Image], path: Path, duration_seconds: float, fps: int) -> None:
    if imageio is None or np is None:
        raise RuntimeError('MP4 output requires imageio and numpy to be installed.')

    repeated_frames = max(1, int(round(duration_seconds * fps)))
    with imageio.get_writer(
        path,
        fps=fps,
        codec='libx264',
        quality=10,
        pixelformat='yuv444p',
        macro_block_size=1,
        ffmpeg_params=['-crf', '12', '-preset', 'slow'],
    ) as writer:
        for frame in frames:
            array = np.array(frame.convert('RGB'))
            for _ in range(repeated_frames):
                writer.append_data(array)


def main() -> None:
    args = parse_args()
    seconds_per_position = (
        args.time_per_move
        if args.time_per_move is not None
        else args.seconds_per_position
    )

    if seconds_per_position <= 0:
        raise ValueError('--time-per-move / --seconds-per-position must be > 0.')

    game = read_game(args.input)
    positions = collect_positions(
        game,
        include_initial=args.include_initial,
        after_move_color=args.after_move_color,
    )
    frames = [
        render_frame(
            state,
            board_size=args.board_size,
            side_filter=args.side_filter,
            orientation=args.orientation,
        )
        for state in positions
    ]

    paths = output_paths(args.input, args.output, args.format)
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix.lower() == '.gif':
            save_gif(frames, path, seconds_per_position)
        elif path.suffix.lower() == '.mp4':
            save_mp4(frames, path, seconds_per_position, args.fps)
        else:
            raise ValueError(f'Unsupported output format: {path.suffix}')
        print(f'Wrote {path}')


if __name__ == '__main__':
    main()