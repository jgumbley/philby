"""Bare-bones Textual app shown through ttyd."""

import subprocess

from textual.app import App, ComposeResult
from textual.containers import Center, Horizontal, Vertical
from textual.widgets import Button, Static


class BareBonesApp(App):
    """Minimal app used as the ttyd landing UI."""

    BINDINGS = [("q", "quit", "Quit")]

    CSS = """
    Screen {
        align: center middle;
    }

    #card {
        width: 70;
        border: round #4f46e5;
        padding: 1 2;
    }

    #title {
        width: 100%;
        content-align: center middle;
        margin-bottom: 1;
    }

    #actions {
        width: 100%;
    }

    #spacer {
        width: 1fr;
    }

    Button {
        min-width: 14;
    }
    """

    def compose(self) -> ComposeResult:
        yield Center(
            Vertical(
                Static(
                    "Philby2 TUI\n\nPick a pill to shell out.\n\nPress q to quit.",
                    id="title",
                ),
                Horizontal(
                    Button("Red pill", id="red-pill", variant="error"),
                    Static("", id="spacer"),
                    Button("Blue pill", id="blue-pill", variant="primary"),
                    id="actions",
                ),
                id="card",
            )
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "blue-pill":
            target = "blue"
        elif event.button.id == "red-pill":
            target = "red"
        else:
            return

        with self.suspend():
            subprocess.run(["make", target], check=True)


if __name__ == "__main__":
    BareBonesApp().run()
