# Projects Runner App

Tauri + React + TypeScript desktop app for saving and running project commands.

## UI stack

- **beUI v2 full visual language** (mono surfaces, pill controls, soft borders, spring motion)
- **Tailwind CSS v4** token bridge in `src/styles/tailwind.css`
- **Local UI primitives** in `src/components/ui/*` (Radix where needed + CVA/Tailwind)
- **beUI motion components** vendored under `src/components/motion/*`
  - `animated-toast-stack` (global toasts)
  - `action-swap` (command run/stop CTA)
  - `tooltip`, `theme-toggle`
- Shared motion tokens: `src/lib/ease.ts`
- Accent themes: `src/lib/theme.ts` (`mono` default + violet/blue/emerald/rose/amber/sky)
- Class helper: `src/lib/utils.ts` (`cn`)

### Install / sync beUI components

beUI is copy-source (not an npm runtime package). Registry config lives in `components.json`.

```bash
# example
npx shadcn@latest add @beui/animated-toast-stack
npx shadcn@latest add @beui/action-swap
npx shadcn@latest add @beui/tabs
npx shadcn@latest add @beui/switch
npx shadcn@latest add @beui/checkbox
```

Or compare against raw sources:

- https://beui.dev/r
- https://beui.dev/r/{slug}/raw

See `docs/beui-v2-migration-audit.md` for the migration scoreboard and PR history.

## Scripts

```bash
npm run dev
npm run build
npm run tauri
npm run beui:sync
```

## Recommended IDE Setup

- VS Code + Tauri + rust-analyzer
