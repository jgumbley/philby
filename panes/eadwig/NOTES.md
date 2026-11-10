# eaadwig frame — OpenMW game launch setup

## Task
Launch the eaadwig-world OpenMW game fullscreen on its own screen, and make it happen automatically at sway boot.

## Result (working)
- OpenMW runs fullscreen (2160x1350) on eDP-1, sway workspace 4.
- User's work stays on DP-3: ws1 kitty, ws2 1password, ws3 firefox.
- Note: eDP-1 is the laptop panel; reloading kanshi brings it up. DP-3 is the external 3840x2160 display.

## Files changed
- ~/.local/bin/eaadwig-play (new, executable)
    #!/bin/bash
    set -eu
    WORLD=/home/system/wip/eaadwig/eaadwig-world
    SCENE="${1:-scriptorium}"
    cd "$WORLD"
    swaymsg workspace number 4
    exec make play SCENE="$SCENE"
- ~/.config/sway/config (edited), added after shared output config:
    ### eaadwig world game: dedicated screen (eDP-1), workspace 4, fullscreen
    exec ~/.local/bin/eaadwig-play
    assign [class="openmw"] workspace number 4
    for_window [class="openmw"] fullscreen enable
    workspace 4 output eDP-1

## Backing details
- Game world: /home/system/wip/eaadwig/eaadwig-world
- Launch mechanism: make play SCENE=<scene> -> python3 ../openmw-worldbuilding/runtime.py --world "$PWD" --scene "$SCENE"
- runtime.py builds the openmw command line; starts in the scene cell, --skip-menu=1 --no-sound.
- Scenes (game.json): scriptorium (default), buildwas_riverside, hanley_mill, arley_passage.
- Packaged build: ~/wip/eaadwig/eaadwig-world/dist/eaadwig-world.tar.gz (ships runtime.py as launch.py).
- OpenMW binary: /opt/games/openmw/current/bin/openmw

## Caveats / open items
- Boot exec launches one game instance per sway start; user may prefer a keybind instead.
- If only one output at boot, "workspace 4 output eDP-1" is ignored and game fullscreens wherever ws4 lands.
- No duplicate instance guard in launcher.

## Environment
- Tools live under /home/system/wip (shared network-filesystem topology); frame dirs are /home/system/wip/philby/frames/<frame>.
- The user's earlier reference to "../eaadwig" meant ~/wip/eaadwig (not the frame dir).

## Storyboard TUI (frame tool)

`make storyboard STORYBOARD=buildwas` (run inside tmux) opens the curses
storyboard review TUI as its OWN tmux window (`storyboard`).

- TUI source: /home/system/wip/eaadwig/openmw-worldbuilding/storyboard_review.py
  - curses app; renders candidate images inline via kitty image protocol (kitten icat).
  - Keys: arrows/j/k browse, Enter choose, c add, O clone, p prompt, G generate,
    F feedback, D defer, Q quit.
- Entry point: workset.py --world <world> storyboard-review --storyboard <id>
- Storyboards: <world>/notes/storyboards/<id>; only `buildwas` exists.
- Must run inside tmux; TMUX must remain set so `kitten icat` can use passthrough.

### Why a new window, not a split

Philby's UI is window-based: one tmux window per frame (window name and frame
frame title = slug), navigated with Ctrl-Home/Ctrl-End (previous/next-window) and
the `+` frame selector. Splitting an agent's window adds a second frame that the
window-cycling selector skips, breaking navigation. The storyboard therefore gets
its own window (`tmux new-window -n storyboard`), leaving `2:eadwig` at one frame.

- Sets tmux allow-passthrough on (kitty images through tmux need it).
- The toolkit's own `storyboard-window` (detached kitty) target does not work here:
  kitty's config `shell /usr/bin/tmux` double-wraps it in tmux.
