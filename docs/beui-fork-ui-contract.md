# beUI Fork UI Contract

This app uses a compact local fork of beUI rather than a verbatim upstream copy.

## Visual rules

- Borders must remain visible in both light and dark themes at idle state.
- `outline` and `secondary` buttons are bordered actions, not text-only controls.
- `ghost` buttons are for low-emphasis actions and may gain a border on hover.
- Inputs, selects, textareas, toggles, and cards should use the shared border tokens instead of local opacity hacks.
- Prefer `border-border` and `border-border-strong` over repeated `/70` opacity overrides.
- Prefer `bg-card`, `bg-input`, and the shared token-driven mixes over ad hoc `bg-card/40` and `bg-input/20`.

## When editing UI

- Change tokens and shared primitives first.
- Only add per-screen overrides when the primitive is insufficient for the layout.
- If a control starts looking borderless in screenshots, fix the token or primitive before patching one screen.
