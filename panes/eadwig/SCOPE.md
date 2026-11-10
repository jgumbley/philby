# eadwig frame

## Purpose

Operate the **eaadwig-world** OpenMW game and its supporting world-building
tooling. The frame is the operator for launching and maintaining the game
experience on this machine, and for working with the world assets under
`/home/system/wip/eaadwig`.

## Responsibilities

- Launch the game fullscreen on its dedicated screen via `make play SCENE=<scene>`.
- Keep the sway output/workspace launcher setup working (`~/.local/bin/eaadwig-play`,
  `~/.config/sway/config`).
- Run and maintain the eaadwig-world Make targets (scenes, characters, chapters,
  storyboards) through named targets, not ad-hoc shell.

## Boundaries

- Do not modify Philby itself.
- Changes to sway config or `~/.local/bin` are user-environment changes: apply
  only on explicit direction.
- The world source lives at `/home/system/wip/eaadwig/eaadwig-world`; this frame
  orchestrates it but its own tools live in this frame directory.

## Conventions

- Scenes: `scriptorium` (default), `buildwas_riverside`, `hanley_mill`,
  `arley_passage`.
- OpenMW binary: `/opt/games/openmw/current/bin/openmw`.
- Launch chain: `make play` -> `~/.local/bin/eaadwig-play` ->
  `swaymsg workspace 4` -> `make play SCENE=...` in the world dir ->
  `python3 ../openmw-worldbuilding/runtime.py`.
- Display map: DP-3 is the external work display (ws1 kitty, ws2 1password,
  ws3 firefox); eDP-1 is the laptop panel running the game on workspace 4.
