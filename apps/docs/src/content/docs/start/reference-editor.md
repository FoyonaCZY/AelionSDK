---
title: Run the reference editor
description: Launch the framework-free reference editor to inspect the public SDK workflow.
---

The reference editor is a product-oriented example with local media import, timeline editing, linked A/V movement, playback, undo/redo, IndexedDB recovery and WebM/H.264 MP4 export.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:editor
```

It intentionally uses public package entry points. Treat it as an integration reference, not as a UI library: copy the Session wiring and persistence boundaries into your own application, then replace the controls and state model.
