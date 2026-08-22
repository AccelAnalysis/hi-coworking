# PR preview smoke check

This disposable documentation-only change exists solely to exercise the automatic pull-request visual preview pipeline after the preview infrastructure was merged.

The second commit intentionally triggered the installed workflow after PR #25 merged. The third commit re-runs the smoke test after the legacy-gitlink checkout hardening from PR #27 was merged into `main`.
