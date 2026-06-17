# Chess Space Control Animator

A command-line tool that converts a chess PGN into an animated visualization of board control. The animation highlights which side controls each square after every move, displays pieces using chess glyphs, and shows control percentages for both White and Black.

---

## Features

* Render a PGN game's mainline into an animated GIF or MP4
* Visualize square control by White and Black
* Display pieces directly on the board
* Highlight recently moved pieces
* Show board control percentages for each position
* Filter to show only White or Black controlled squares
* Generate GIF, MP4, or both formats
* Support White or Black board orientation

---

## Requirements

### Required Packages

```bash
pip install python-chess pillow
```

### Additional Packages for MP4 Output

```bash
pip install imageio numpy
```

---

## Basic Usage

Render a PGN file to a GIF:

```bash
python space_control.py game.pgn
```

This creates:

```text
game.gif
```

---

## Output Options

### Specify an Output File

```bash
python space_control.py game.pgn -o output.gif
```

### Create an MP4

```bash
python space_control.py game.pgn --format mp4 -o output.mp4
```

### Create Both GIF and MP4

```bash
python space_control.py game.pgn --format both -o output
```

This generates:

```text
output.gif
output.mp4
```

---

## Command Line Options

| Option                                  | Description                                        |
| --------------------------------------- | -------------------------------------------------- |
| `-o`, `--output`                        | Output file path                                   |
| `--format {gif,mp4,both}`               | Output format (default: gif)                       |
| `--seconds-per-position`                | Duration each position is displayed (default: 2.0) |
| `--time-per-move`                       | Alias for `--seconds-per-position`                 |
| `--fps`                                 | Frames per second for MP4 output (default: 12)     |
| `--board-size`                          | Board size in pixels (default: 960)                |
| `--side-filter {both,white,black}`      | Display only selected side's control               |
| `--orientation {white,black}`           | Board orientation (default: white)                 |
| `--include-initial`                     | Include starting position before first move        |
| `--after-move-color {both,white,black}` | Keep only positions after specified side has moved |

---

## Examples

### Faster Animation

```bash
python space_control.py game.pgn --seconds-per-position 1
```

### Larger Board

```bash
python space_control.py game.pgn --board-size 1200
```

### Black's Perspective

```bash
python space_control.py game.pgn --orientation black
```

### Show Only White-Controlled Squares

```bash
python space_control.py game.pgn --side-filter white
```

### Show Only Black-Controlled Squares

```bash
python space_control.py game.pgn --side-filter black
```

### Include Starting Position

```bash
python space_control.py game.pgn --include-initial
```

### Show Only Positions After White Moves

```bash
python space_control.py game.pgn --after-move-color white
```

### Show Only Positions After Black Moves

```bash
python space_control.py game.pgn --after-move-color black
```

### Generate a High-Quality MP4

```bash
python space_control.py game.pgn \
  --format mp4 \
  --fps 30 \
  --seconds-per-position 1
```

---

## Example Workflow

```bash
pip install python-chess pillow imageio numpy

python space_control.py my_game.pgn \
  --format both \
  --board-size 1200 \
  --seconds-per-position 1.5 \
  --include-initial
```

Output:

```text
my_game.gif
my_game.mp4
```

---

## Notes

* The script reads only the PGN mainline.
* If no output file is specified, the output name is derived from the PGN filename.
* MP4 generation requires both `imageio` and `numpy`.
* Recently moved pieces are highlighted in green.
* Control percentages are calculated based on the number of squares controlled by each side.
* Tied control squares are displayed in a separate color.
