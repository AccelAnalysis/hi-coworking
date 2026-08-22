# PR preview smoke check

This disposable documentation-only change exists solely to exercise the automatic pull-request visual preview pipeline after the preview infrastructure was merged.

The second commit intentionally triggers the post-merge `synchronize` event so the installed workflow is exercised from `main`.
