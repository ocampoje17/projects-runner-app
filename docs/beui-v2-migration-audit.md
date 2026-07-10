# BEUI v2 Migration Audit — projects-runner-app

**Date:** 2026-07-10  
**Scope:** `projects-runner-app` vs [beUI v2 / starc007/ui-components](https://github.com/starc007/ui-components)  
**Primary commit:** `406ac3b` — `chuyen sang dung beui`  
**Method:** worktree inspection + upstream registry (`https://beui.dev/r`) + raw source compare  

---

## 1. Executive summary

| Dimension | Score | Evidence |
|---|---:|---|
| Foundation (Tailwind/tokens/utils/alias) | **90%** | `tailwind.css`, `@` alias, `cn`, partial `ease` |
| beUI motion component adoption | **5%** | 2 / 44 registry components present; 1 used in production |
| UI primitive modernization (Radix+Tailwind) | **65%** | 13 local primitives, dual-class residual |
| Feature screens off legacy CSS | **25%** | Components split, still `App.css`-driven |
| Registry/sync hygiene | **10%** | No `components.json`, no `@beui` install path |
| **Overall beUI v2 migration** | **~32%** | Ready foundation; product surface still hybrid |

### What “done” would mean
1. beUI motion controls used where interaction benefits from motion.
2. Local primitives no longer dual-class against `App.css`.
3. Layout domains migrated off monolithic CSS.
4. Install/sync path documented (`@beui` registry or pinned vendored sources).

### Current truth
- App is **beUI-ready**, not **beUI-native**.
- Commit mixed **architecture refactor** + **partial beUI seed**.
- Production beUI usage is almost only toast stack.

---

## 2. Upstream beUI inventory (source of truth)

Registry: `https://beui.dev/r` → **44 components**.

### Motion (product-relevant)
| Slug | Local status | Relevance to Projects Runner |
|---|---|---|
| `action-swap` | Present, unused | High — run/stop/restart CTA |
| `animated-toast-stack` | Present, used | High — global feedback |
| `button` | Missing | High — press/loading states |
| `tabs` | Missing (local Radix tabs only) | High — project/terminal tabs |
| `switch` | Missing (local Radix switch only) | High — settings/command toggles |
| `input` | Missing (local static input only) | Medium-High — forms |
| `select` | Missing (local Radix select only) | Medium-High — settings/forms |
| `checkbox` | Missing (local Radix checkbox only) | Medium — import/process dialogs |
| `theme-toggle` | Missing | Medium — appearance settings |
| `tooltip` | Missing | Medium — dense icon actions |
| `popover` | Missing | Medium — menus/overflow |
| `drawer` | Missing | Low-Medium — settings/mobile later |
| `loader` | Missing | Medium — pending ops |
| `animated-badge` | Missing | Medium — run status badges |
| `shared-layout-bg` | Missing | Medium — sidebar/project selection |
| `bouncy-accordion` | Missing | Low-Medium — settings groups |
| `morphing-modal` | Missing | Low — multi-step dialogs |
| `table` | Missing | Low currently |
| `radio` | Missing | Low currently |
| `range-slider` | Missing | Low |
| `scroll-animation` | Missing | Low |
| `bottom-sheet` | Missing | Low (desktop app) |
| `dock` | Missing | Low |
| `tilt-card` | Missing | Low |
| `marquee` | Missing | Low |
| `text-animation` / `number` | Missing | Low-Medium (status counters) |
| `cylinder-carousel` / `shader-background` / `wheel-picker` | Missing | Low |

### Blocks (mostly optional)
`command-palette`, `expandable-action-bar`, `overflow-actions`, `expandable-tabs`, `swipeable-list`, `file-upload`, `feedback-widget`, `dynamic-island`, `bloom-menu`, `otp-input`, `prediction-market`, `wallet-card`, `swap`, `not-found` — **none present**.  
Highest optional ROI: `command-palette`, `overflow-actions`, `expandable-action-bar`.

---

## 3. Foundation checklist

| File | Status | Score | Notes |
|---|---|---:|---|
| `package.json` | Partial | 85% | Has `motion`, Tailwind 4, Radix set; no shadcn/beUI tooling |
| `vite.config.ts` | Done | 95% | Tailwind plugin + `@` alias + chunking |
| `tsconfig.json` | Done | 95% | `@/*` paths |
| `src/main.tsx` | Partial | 80% | Loads both `tailwind.css` and legacy `App.css` |
| `src/styles/tailwind.css` | Done-ish | 90% | Token bridge + utilities; no full beUI globals |
| `src/lib/utils.ts` | Done | 100% | Matches beUI `cn()` |
| `src/lib/ease.ts` | Partial | 40% | Missing `EASE_IN_OUT`, `EASE_DRAWER`, `SPRING_PANEL`, `SPRING_LAYOUT`, `SPRING_MOUSE` |
| `components.json` | Missing | 0% | No registry install config |
| `README.md` | Missing guidance | 0% | Still stock Tauri template |

### Dependency notes
| Package | Installed | Used in `src` | Note |
|---|---|---|---|
| `motion` | Yes | Yes (toast/action-swap) | Required for beUI |
| `class-variance-authority` | Yes | Yes (button/badge) | Local primitive system |
| `@radix-ui/react-*` core set | Yes | Mostly yes | Avatar/dialog/select/switch/tabs/checkbox/slot |
| `@radix-ui/react-dropdown-menu` | Yes | **No** | Dead dependency |
| `@radix-ui/react-scroll-area` | Yes | **No** | Dead dependency |

---

## 4. Local motion components (beUI-derived)

### 4.1 `src/components/motion/animated-toast-stack.tsx`
| Field | Value |
|---|---|
| Status | **Partial / Production** |
| Score | **75%** |
| Upstream | present, larger (`504` lines vs local `366`) |
| Used by | `src/App.tsx` (`useAnimatedToastStack`, `<AnimatedToastStack />`) |
| Gaps vs upstream | missing `ToastClassNames`; smaller implementation; customized |
| App integration depth | shallow: only **1** `showToast(` call site in `App.tsx` |
| Residual risk | diverged from upstream; no sync pin |

**Verdict:** Adopted and live, but not fully featured / not broadly wired.

### 4.2 `src/components/motion/action-swap.tsx`
| Field | Value |
|---|---|
| Status | **Vendored / Dead code** |
| Score | **35%** (source present, product value 0 until wired) |
| Upstream | present, close API surface |
| Used by | **none** outside own file |
| Best insertion points | `project-runtime.tsx` CommandCard run/stop/restart controls |
| Residual risk | ships unused code; will drift |

**Verdict:** Seeded, not migrated into UX.

---

## 5. Local UI primitives checklist

Status key:
- **Done**: Tailwindized, no meaningful legacy dependency for own rendering
- **Hybrid**: Tailwind + legacy class dual-stack
- **Legacy-coupled**: still depends on `App.css` for look
- **App-specific**: not from beUI; keep as product helper

| File | Status | Score | Stack | Legacy dual-class | Consumers (feature layer) | beUI equivalent | Next action |
|---|---|---:|---|---|---|---|---|
| `ui/button.tsx` | Hybrid | 70% | Radix Slot + CVA + Tailwind | `btn`, `btn-*`, `btn-size-*` | Almost all screens (150 refs) | `@beui/button` | Decide: keep static CVA or replace with beUI motion button; then drop legacy classes |
| `ui/badge.tsx` | Hybrid | 70% | CVA + Tailwind | `badge`, `badge-*` | runtime/detail/import/settings | `@beui/animated-badge` (optional) | Drop legacy classes; optional animated status variant |
| `ui/card.tsx` | Hybrid | 65% | Tailwind | `card`, `card-header`, `card-content` | settings/runtime/commands/import | none direct | Migrate card chrome fully to utilities; remove CSS card block |
| `ui/input.tsx` | Hybrid | 60% | Tailwind | `field` | forms + rename inputs | `@beui/input` | Either finish static Tailwind or adopt beUI input motion |
| `ui/textarea.tsx` | Hybrid | 60% | Tailwind | `field textarea` | notes + forms | none direct | Same as input |
| `ui/label.tsx` | Hybrid | 75% | Tailwind | `label` | forms/settings | none | Easy cleanup |
| `ui/dialog.tsx` | Hybrid | 70% | Radix dialog + Tailwind | `dialog-overlay/content/header/close` | all dialogs | `@beui/morphing-modal` (different model) | Keep Radix dialog; remove CSS dependency |
| `ui/dialog-form.tsx` | App-specific Done-ish | 85% | Tailwind helpers | mostly clean | forms/import/process | none | Keep; good product primitive |
| `ui/select.tsx` | Hybrid | 65% | Radix select + Tailwind | many `select-*` | settings + command form | `@beui/select` | High-value motion upgrade later |
| `ui/tabs.tsx` | Hybrid | 65% | Radix tabs + Tailwind | `tabs-list/trigger/content` | project detail + terminal | `@beui/tabs` | High-value motion upgrade |
| `ui/switch.tsx` | Mostly modern | 80% | Radix switch + Tailwind | token name only | settings + command form | `@beui/switch` | Optional spring thumb upgrade |
| `ui/checkbox.tsx` | Mostly modern | 80% | Radix checkbox + Tailwind | token name only | import/process | `@beui/checkbox` | Optional draw-check upgrade |
| `ui/avatar.tsx` | Hybrid | 70% | Radix avatar + Tailwind | `avatar*` | entity avatar + forms | none direct | Drop legacy classes |

### Primitive usage intensity (feature/app layer)
| Primitive family | Approx refs | Hot files |
|---|---:|---|
| Button | 150 | workspace-shell, project-detail-commands, project-runtime, dialogs, settings |
| Label | 53 | entity-avatar, forms, settings |
| Card | 49 | settings-panels, project-runtime |
| Dialog family | 43+ | import/process/project/command dialogs |
| Input | 38 | forms, rename, app orchestration |
| Badge | 22 | runtime/status/import |
| Avatar family | 14–18 | entity-avatar, forms |
| Tabs family | 12–18 | project-detail, project-runtime |
| Select family | 11–24 | settings, command form |
| Switch | 6 | settings, command form |
| Checkbox | 9 | import/process |
| Textarea | 8 | notes/forms |
| ActionSwap* | 0 | — |
| AnimatedToastStack / hook | 2 (+1 showToast call) | App.tsx |

---

## 6. Feature / screen adoption checklist

| File | Role | UI primitives used | Legacy semantic CSS dependency | beUI motion used | Status | Score | Priority |
|---|---|---|---|---|---|---:|---|
| `App.tsx` | orchestration | toast only | low in JSX | **AnimatedToastStack** | Partial | 55% | P0 keep/expand toast coverage |
| `workspace-shell.tsx` | sidebar/header chrome | Button | high (`sidebar*`, `project-row`) | none | Legacy layout | 25% | P1 layout migration |
| `app-workspace.tsx` | workspace composition | none direct | medium | none | Structural only | 40% | P2 |
| `project-detail.tsx` | detail shell + tabs | Badge, Tabs | medium (`project-detail*`) | none | Hybrid | 40% | P1 (tabs) |
| `project-detail-commands.tsx` | sections/commands | Badge, Button, Card, Input | medium-high | none | Hybrid | 35% | P0 ActionSwap candidate parent |
| `project-runtime.tsx` | command cards + terminal | Badge, Button, Card, Tabs | **high** | none | Hybrid | 30% | **P0** run/stop/restart + terminal tabs |
| `project-detail-notes.tsx` | notes UI | Badge, Button, Textarea | high (`project-note*`) | none | Legacy layout | 30% | P2 |
| `SettingsPage.tsx` | settings shell | Button | medium | none | Hybrid | 35% | P1 |
| `settings-panels.tsx` | appearance/terminal/data | Button, Select, Switch | **very high** | none | Legacy layout | 25% | P1 theme-toggle/switch/select |
| `project-form-dialog.tsx` | project create/edit | Button, Dialog*, Input, Label, Textarea | low-medium | none | Hybrid forms | 55% | P1 input/dialog polish |
| `command-form-dialog.tsx` | command create/edit | Button, Dialog*, Input, Label, Select, Switch, Textarea | low-medium | none | Hybrid forms | 55% | P1 |
| `import-dialogs.tsx` | import flow dialogs | Button, Dialog* | medium | none | Hybrid | 50% | P2 |
| `import-dialog-sections.tsx` | import content | Badge, Button, Checkbox | high (`import-*`) | none | Legacy content | 30% | P2 |
| `process-dialogs.tsx` | process/port dialogs | Button, Checkbox, Dialog* | low-medium | none | Hybrid | 55% | P2 |
| `dialog-shared.tsx` | shared dialog bits | Button, dialog-form | low | none | Good helper | 70% | keep |
| `entity-avatar.tsx` | avatar/icon picker | Avatar | low | none | Good helper | 75% | keep |
| `app-dialogs.tsx` | dialog wiring | composition | low | none | Structural | 60% | keep |
| `project-dialogs.tsx` | thin re-export/wiring | Dialog refs | low | none | Structural | 60% | keep |
| hooks (`use-app-preferences`, runtime, notes, import, sections) | logic | n/a | n/a | n/a | Not UI migration | n/a | only touch when wiring motion |

### Hotspots (highest migration leverage)
1. `project-runtime.tsx` — actions + terminal tabs + badges  
2. `settings-panels.tsx` — switches/selects/theme cards  
3. `workspace-shell.tsx` — sidebar active states  
4. `project-detail.tsx` / `project-detail-commands.tsx` — tabs + command CTA  
5. `App.tsx` — broaden toast statuses (success/error/loading)

---

## 7. `App.css` residual map

| Domain | Approx range / density | Still needed? | Migration target |
|---|---|---|---|
| Theme tokens (`:root`, `.theme-light/dark`) | top of file, still core | **Yes** (source of CSS vars) | keep, maybe split `theme.css` |
| Shell / sidebar / workspace | ~268–500 | Yes for now | utility classes / shell components |
| Project detail / notes / commands | ~353–920 | Yes | component-local Tailwind |
| Terminal | ~937–1135+ | Yes | terminal component styles |
| Primitive `.btn/.field/.badge/.card` | ~782–1300+ | **Transitional only** | delete after dual-class removal |
| Dialog/select/avatar CSS | ~1378–2681 | Transitional | delete as primitives finish |
| Settings / import | dense (~1459–2300) | Yes | panel-level Tailwind |
| Toast CSS | **none** | n/a | already motion-component owned |

**Size:** ~2895 lines / ~55 KB.  
**Conclusion:** CSS architecture not retired; primitives are dual-running.

---

## 8. Drift / fidelity vs upstream

| Artifact | Local | Upstream | Same? | Drift notes |
|---|---:|---:|---|---|
| `utils.ts` | 7 lines | 7 lines | Yes (functionally) | OK |
| `ease.ts` | 17 lines | 50 lines | No | incomplete token set |
| `action-swap.tsx` | 321 / 9522B | 333 / 10319B | No | close API, source diverged |
| `animated-toast-stack.tsx` | 366 / 10027B | 504 / 13758B | No | missing classNames API / reduced implementation |
| Install method | manual copy | shadcn `@beui/*` registry | No | no reproducible sync |

---

## 9. Scoring model used

For each file:
- **0–20** absent needed capability
- **21–40** present source only / unused / mostly legacy
- **41–60** hybrid in production
- **61–80** modernized but incomplete/cleanup remains
- **81–100** complete for chosen architecture

Overall ~32% is weighted toward **user-visible beUI adoption**, not just repo prep.

---

## 10. PR sequence (concrete, ordered)

### PR-0 — Audit baseline (docs only)
- Add this document
- No runtime change
- Acceptance: team agrees scope (motion-first vs full visual rewrite)

### PR-1 — Foundation hardening
**Files:** `src/lib/ease.ts`, `package.json` (optional dep cleanup), docs  
**Work:**
1. Complete `ease.ts` tokens from upstream.
2. Remove unused `@radix-ui/react-dropdown-menu` and `@radix-ui/react-scroll-area` **or** implement them intentionally.
3. Add short README section: “UI stack = Radix primitives + selected beUI motion”.
**Acceptance:** ease exports match upstream set; no dead radix deps unless justified.

### PR-2 — Toast coverage completion
**Files:** `App.tsx`, maybe mutation helpers  
**Work:**
1. Route success/error/loading events through `showToast` consistently (project/command/import/settings actions).
2. Use toast statuses (`success` / `error` / `loading` / `info`).
3. Keep `AnimatedToastStack` as global host.
**Acceptance:** major user actions produce toast; no ad-hoc alert UI remains.

### PR-3 — Wire `ActionSwap` into command CTA
**Files:** `project-runtime.tsx`, maybe `project-detail-commands.tsx`  
**Work:**
1. Replace run/stop (and optionally restart) button pair with `ActionSwapButton` state machine.
2. Map states: idle→run, running→stop, pending→loading label/icon.
3. Preserve keyboard/aria labels.
**Acceptance:** ActionSwap imported and used; no dead `action-swap.tsx`.

### PR-4 — Dual-class cleanup for static primitives
**Files:** all `src/components/ui/*`, corresponding `App.css` blocks  
**Work (order):**
1. `label`, `badge`, `avatar`
2. `input`, `textarea`
3. `button`, `card`
4. `dialog`, `select`, `tabs`
5. Delete orphaned CSS selectors after visual parity check
**Acceptance:** primitives render correctly with Tailwind only; legacy class names removed from component `className` roots.

### PR-5 — beUI control upgrades (high ROI)
Install/copy and adapt one by one:
1. `@beui/tabs` → project detail + terminal tabs
2. `@beui/switch` → settings + command form
3. `@beui/checkbox` → import/process
4. `@beui/button` (stateful) → async actions (save/import/kill ports)
5. `@beui/select` → settings selects
6. `@beui/input` → form validation error/success motion
**Acceptance:** each control used in ≥1 real screen; reduced-motion safe.

### PR-6 — Settings / theme motion
**Files:** `settings-panels.tsx`, `use-app-preferences.ts`  
**Work:**
1. Optional `@beui/theme-toggle` or shared-layout active pill for theme/accent.
2. Convert settings cards from semantic CSS to Tailwind layout.
**Acceptance:** settings appearance panel no longer depends on large `.theme-grid` CSS block (or block reduced substantially).

### PR-7 — Shell / workspace layout migration
**Files:** `workspace-shell.tsx`, `app-workspace.tsx`, `project-detail*.tsx`, `App.css` shell sections  
**Work:**
1. Sidebar/project row active states via Tailwind + optional `shared-layout-bg`.
2. Workspace header/toolbar utility migration.
3. Split `App.css` into `theme.css` + remaining domain files if still needed.
**Acceptance:** shell visual parity; CSS line count materially down.

### PR-8 — Optional blocks
Only if product asks:
- `command-palette` for project/command jump
- `overflow-actions` / `expandable-action-bar` for dense command actions
- `tooltip` on icon-only buttons
**Acceptance:** feature-flag or clearly scoped UX win.

### PR-9 — Sync hygiene
**Work:**
1. Add `components.json` (or documented vendor policy).
2. Pin beUI component versions/SHAs in docs.
3. Script or checklist to re-diff vendored files against `https://beui.dev/r/{slug}/raw`.
**Acceptance:** reproducible upgrade path.

---

## 11. Recommended decision (to avoid thrash)

Choose one architecture explicitly:

### Option A — **Motion-first hybrid (recommended)**
- Keep Radix/static primitives for dense desktop forms.
- Use beUI for toast, action swap, tabs indicator, switch/checkbox flourish, stateful buttons.
- Fastest path to visible quality without rewriting all CSS.

### Option B — **Full beUI control replacement**
- Replace button/input/select/tabs/switch/checkbox with beUI motion versions broadly.
- Higher polish, higher regression risk, more CSS deletion work.

This audit assumes **Option A** for sequencing, while still listing full replacement opportunities.

---

## 12. Immediate next 5 engineering tasks

1. Complete `src/lib/ease.ts` tokens.  
2. Expand toast call sites in `App.tsx` mutations.  
3. Wire `ActionSwapButton` into `CommandCard` run/stop.  
4. Remove dual-class from `label/badge/avatar`.  
5. Add `docs` note + README UI stack section.

---

## 13. File-by-file scoreboard (quick scan)

### Done / keep
- `src/lib/utils.ts`
- `src/styles/tailwind.css` (foundation)
- `src/components/ui/dialog-form.tsx` (app helper)
- `src/components/entity-avatar.tsx`
- `src/components/dialog-shared.tsx`

### Partial / hybrid
- all other `src/components/ui/*`
- `src/components/motion/animated-toast-stack.tsx`
- dialogs + detail screens using primitives
- `src/lib/ease.ts`
- `src/main.tsx` (dual CSS entry)

### Present but unused
- `src/components/motion/action-swap.tsx`

### Legacy-heavy
- `src/App.css`
- `settings-panels.tsx`
- `project-runtime.tsx`
- `workspace-shell.tsx`
- `import-dialog-sections.tsx`
- `project-detail-notes.tsx`

### Missing high-value beUI
- button/tabs/switch/input/select/checkbox/theme-toggle/tooltip/loader/animated-badge

---

## 14. Verification commands (for future PRs)

```bash
# typecheck/build
npm run build

# find residual legacy primitive classes in components
rg "className=\{\s*cn\(|\"btn|\"badge|\"field|\"dialog-|\"tabs-|\"select-|\"avatar" src/components/ui

# find beUI usage
rg "components/motion|ActionSwap|AnimatedToastStack" src

# dead deps
rg "@radix-ui/react-dropdown-menu|@radix-ui/react-scroll-area" src
```

---

## 15. Bottom line

`projects-runner-app` has completed the **setup phase** of beUI v2 and landed **one real production integration** (animated toast), plus an **unwired second component** (action-swap). UI primitives are mid-migration (Tailwind/CVA/Radix hybrid). Feature screens are componentized but still largely styled by `App.css`.

**Progress:** ~32% overall.  
**Not blocked.** Clear PR sequence exists from foundation cleanup → wire existing beUI → cleanup dual-class → adopt high-ROI beUI controls → migrate layout CSS.

---

## 16. Implementation status (2026-07-10 execution)

Executed in-repo after this audit:

| Item | Status |
|---|---|
| Complete `ease.ts` tokens | Done |
| Upstream toast + action-swap refresh | Done |
| Wire ActionSwap run/stop | Done |
| Expand mutation toasts | Done |
| beUI Switch/Checkbox/Tabs | Done (local ui wrappers) |
| Motion Button press feedback | Done |
| Dual-class cleanup on primitives | Done |
| Remove unused Radix deps | Done |
| Workspace/settings/detail utility migration | Partial-to-Done (hotspots) |
| `components.json` + README sync path | Done |
| Production build (`tsc && vite build`) | Passing |

Remaining optional polish:
- deeper App.css deletion pass after visual QA
- optional beUI select/input/theme-toggle full replacements
- broader ActionSwap states (restart) if desired
