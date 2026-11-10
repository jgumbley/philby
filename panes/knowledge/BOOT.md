Run `make viewer-doctor`, then `make viewer-start` and `make viewer-status`.
The viewer must serve this frame's published graph while the frame is open.
Report its URL. A missing dependency or occupied port is a failure to report,
not a reason to silently skip the viewer or stop another frame's service.
Do not seed articles or journals during startup. `make close` stops the viewer.
