# Visi Chess

Uses square highlighting to help visualize piece influence on the board.

<a href="[https://example.com](https://kleelof.github.io/visi-chess/)" target="_blank">Check it out!</a> ( opens in a new window )


This workspace now contains two apps:

- The React/Vite board viewer in `src/`
- A Python command-line renderer in `python_app/space_control_cli.py`

## Frontend

```bash
npm install
npm run dev
```

## Python CLI

The Python CLI reads a PGN file, walks its mainline, renders the space-control heat map for each resulting position, removes all chess pieces, and writes an animated GIF by default. Each position holds for 2 seconds unless overridden.

Install the Python dependencies into the configured virtual environment:

```bash
.venv/bin/python -m pip install -r python_app/requirements.txt
```

Basic usage:

```bash
.venv/bin/python python_app/space_control_cli.py game.pgn
```

This writes `game.gif` next to the PGN file.

Useful options:

```bash
.venv/bin/python python_app/space_control_cli.py game.pgn --format mp4
.venv/bin/python python_app/space_control_cli.py game.pgn --format both
.venv/bin/python python_app/space_control_cli.py game.pgn --side-filter white
.venv/bin/python python_app/space_control_cli.py game.pgn --include-initial
.venv/bin/python python_app/space_control_cli.py game.pgn --seconds-per-position 1.5
.venv/bin/python python_app/space_control_cli.py game.pgn --after-move-color black
```

Notes:

- The Python renderer follows the mainline PGN only.
- Squares are fully filled (no fade).
- Colors are piece-style control colors: white, black, and grey.
- Grey means neither side attacks that square.
- Control scoring uses the same formula as the React app: `nonMovingAttacks - movingAttacks`.
- Tie/positive (`>= 0`) goes to the non-moving side; negative goes to the moving side.
