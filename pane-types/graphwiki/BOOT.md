Run `make viewer-doctor`, then `make viewer-start` and `make viewer-status`.
The viewer must serve this pane's published graph while the pane is open.
Report its URL. A missing dependency or occupied port is a failure to report,
not a reason to silently skip the viewer or stop another pane's service.
Do not seed articles or journals during startup. `make close` stops the viewer.
