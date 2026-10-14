---
name: Technical Precision Dark
colors:
  surface: '#121414'
  surface-dim: '#121414'
  surface-bright: '#383939'
  surface-container-lowest: '#0d0e0f'
  surface-container-low: '#1b1c1c'
  surface-container: '#1f2020'
  surface-container-high: '#292a2a'
  surface-container-highest: '#343535'
  on-surface: '#e3e2e2'
  on-surface-variant: '#c3c9b0'
  inverse-surface: '#e3e2e2'
  inverse-on-surface: '#303031'
  outline: '#8d937c'
  outline-variant: '#434935'
  surface-tint: '#a2d824'
  primary: '#ffffff'
  on-primary: '#253600'
  primary-container: '#bcf543'
  on-primary-container: '#4f6e00'
  inverse-primary: '#4a6700'
  secondary: '#c8c6c5'
  on-secondary: '#303030'
  secondary-container: '#474746'
  on-secondary-container: '#b7b5b4'
  tertiary: '#ffffff'
  on-tertiary: '#313030'
  tertiary-container: '#e5e2e1'
  on-tertiary-container: '#656464'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#bcf543'
  primary-fixed-dim: '#a2d824'
  on-primary-fixed: '#141f00'
  on-primary-fixed-variant: '#374e00'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e5e2e1'
  tertiary-fixed-dim: '#c8c6c5'
  on-tertiary-fixed: '#1c1b1b'
  on-tertiary-fixed-variant: '#474646'
  background: '#121414'
  on-background: '#e3e2e2'
  surface-variant: '#343535'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.011em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: -0.006em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.01em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system is crafted for high-aptitude collegiate software engineers competing in intensive algorithmic programming sprints. The atmosphere is sharp, rigorous, and devoid of non-functional ornament. Visual cues borrow from high-performance developer infrastructure: pitch-black terminal depth, ultra-crisp hairline structural grids, and electric lime punctuation that immediately signals runtime execution, completed milestones, and competitive velocity.

Aesthetic foundations merge **Technical Minimalism** with **Developer-Centric Modernism**:
- **Monochrome Dominance:** True near-black backgrounds (`#090909`) create a stark platform where interfaces disappear into the display hardware.
- **Electric Feedback:** `#C6FF4D` acts as an active logic state—drawn deliberately to focus attention on active streaks, submission accepts, primary triggers, and leader rankings.
- **Surgical Density:** Data layers, micro-status tags, and metric tables favor tight baseline alignment, monospaced numerals, and zero unnecessary visual padding.

## Colors

The system uses an uncompromising dark palette where luminosity directly correlates with functional significance.

- **Primary (`#C6FF4D`):** Electric lime accent. Applied exclusively to active run controls, high-impact CTA states, verification marks, active days in calendar matrices, and top-tier standing indicators.
- **Secondary (`#222222`):** Structural divider neutral. Used for hairline borders (`1px solid #222222`), muted icon backgrounds, and inactive state outlines.
- **Tertiary (`#141414`):** Canvas container fill. Elevates code cells, problem summary cards, and dashboard modules above the `#090909` ambient baseline.
- **Neutral (`#888888`):** Informational secondary tone. Used for system labels, inactive metadata, timestamps, and column headers.

### Extended Utility Tones
- **Background Base:** `#090909`
- **Text High-Contrast:** `#FFFFFF`
- **Text Mid-Tone:** `#A1A1AA`
- **Status / Difficulty Scales:**
  - *Easy / Success:* `#C6FF4D` (Accent-aligned) / `#10B981` (Sub-emerald)
  - *Medium / Warning:* `#F59E0B` (Amber)
  - *Hard / Failure:* `#F43F5E` (Rose)

## Typography

The typographic hierarchy separates structural guidance from quantitative data:

- **Geist (Headlines):** High-density geometric sans engineered for screens. Tight letter-spacing values (`-0.03em` to `-0.015em`) maintain tension at larger sizes, imparting an authoritative software CLI tone.
- **Inter (Body Text):** Optimized for functional reading, documentation parsing, and problem descriptions with neutral grotesque geometry.
- **JetBrains Mono (Data & Metadata):** Dedicated to computational readouts, runtime statistics, test execution counters, global leaderboards, memory consumption figures, and algorithmic complexity metrics (`O(N log N)`).

## Layout & Spacing

Layouts follow a 12-column rigid fluid grid on desktop viewports and collapse to 4 columns on mobile. Structural spacing relies on strict multiples of `4px` (`0.25rem`), prioritizing dense horizontal organization over cavernous vertical white space.

- **Gutters & Boundaries:** Multi-tier views (such as code editor adjacent to problem description and terminal outputs) utilize `gutter: 1rem` gaps bounded by `1px solid #222222` structural separators.
- **Density Profiles:**
  - *Data Tables & Trees:* Use `space-xs` and `space-sm` for table row heights and item lists to preserve high line-of-sight velocity.
  - *Component Padding:* Primary metric cards use `space-md` internal padding, while macro dashboard sections leverage `space-lg` to `space-xl` separation.

## Elevation & Depth

Visual depth does not use heavy drop shadows or skeuomorphic bevels. Instead, elevation is strictly established through **Tonal Layering** and **Hairline Outlines**:

- **Layer 0 (Base Canvas):** `#090909` (Root background).
- **Layer 1 (Cards, Code Blocks, Panels):** Surface fill `#141414` coupled with a crisp boundary outline (`1px solid #222222` or `1px solid rgba(255, 255, 255, 0.08)`).
- **Layer 2 (Overlays, Flyouts, Menus):** Fill `#1A1A1A` with a subtle inner border highlight `inset 0 1px 0 rgba(255, 255, 255, 0.06)` and ambient diffused shadow: `0 12px 32px -4px rgba(0, 0, 0, 0.7)`.
- **Active State Highlights:** Accent components do not receive blurred diffuse color glows. Active elements use high-contrast boundary changes (`1px solid #C6FF4D`) or clean solid fills.

## Shapes

The geometric architecture uses `roundedness: 1` (Soft), creating a surgical aesthetic suited for tools and dashboards:

- Standard structural components (containers, cards, code frames, inputs) carry `0.25rem` (`4px`) radii.
- Large floating containers and modal viewports max out at `0.5rem` (`8px`).
- Pills, status tags, and metric indicators are explicitly styled with full rounded caps (`9999px`) to visually differentiate metadata from structural interface boundaries.

## Components

### Buttons
- **Primary Accent:** Fill `#C6FF4D`, label `#000000` (`font-weight: 600`), radius `0.25rem`. Hover shifts fill to `#D4FF70`. Active state scales subtly (`transform: scale(0.98)`).
- **Secondary Neutral:** Background `#141414`, border `1px solid #222222`, text `#FFFFFF`. Hover triggers border transition to `rgba(255, 255, 255, 0.2)`.
- **Ghost Action:** Borderless, text `#888888`, hover text `#FFFFFF` with background `#141414`.

### Difficulty Badges
- Displayed with `label-caps` (`10px` JetBrains Mono, uppercase), `rounded-full`, padding `2px 8px`.
  - **Easy:** Border `1px solid rgba(198, 255, 77, 0.3)`, background `rgba(198, 255, 77, 0.08)`, text `#C6FF4D`.
  - **Medium:** Border `1px solid rgba(245, 158, 11, 0.3)`, background `rgba(245, 158, 11, 0.08)`, text `#F59E0B`.
  - **Hard:** Border `1px solid rgba(244, 63, 94, 0.3)`, background `rgba(244, 63, 94, 0.08)`, text `#F43F5E`.

### Data Tables & Leaderboards
- Dark baseline `#141414`, headers `#888888` in uppercase `label-caps`. Rows separated by hairline borders (`1px solid #1C1C1C`).
- Row hover: `#181818` with rank cells styled using `JetBrains Mono`. Top 3 ranks feature a left vertical indicator in `#C6FF4D`.

### Input Fields & Search Bars
- Background `#101010`, border `1px solid #222222`, corner radius `0.25rem`, typography `13px Inter`.
- Focus state: Border transitions instantly to `1px solid #C6FF4D`, accompanied by zero outer box-shadow ring.

### Cards & Problem Panels
- Background `#141414`, outer edge `1px solid #222222`. Header zones include integrated metadata counters (e.g., acceptance rates, active solver count) separated by a horizontal 1px rule.

### Challenge Tracker Matrix (30-Day Grid)
- Monospaced numeric cells organized across weekly rows. 
- Empty/Unsolved days: `#141414` box with `#222222` outline. 
- Completed: `#C6FF4D` background with black text. 
- Streak connection lines: 1px hairline paths connecting sequential completion nodes.