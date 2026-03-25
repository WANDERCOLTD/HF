---
paths:
  - "apps/admin/app/x/**/*.tsx"
  - "apps/admin/app/x/**/*.css"
  - "apps/admin/app/login/**/*.tsx"
  - "apps/admin/app/login/**/*.css"
  - "apps/admin/components/**/*.tsx"
---

# UI Design System (Zero Tolerance)

No inline `style={{}}` for static properties. No hardcoded hex. No one-off styling.

## Admin Pages (`/x/**`) — `hf-*` classes

- Titles: `hf-page-title`, `hf-page-subtitle`, `hf-section-title`, `hf-section-desc`
- Cards: `hf-card` (radius 16, padding 24), `hf-card-compact`
- Forms: `hf-input`, `hf-btn`, `hf-btn-primary`, `hf-btn-secondary`, `hf-btn-destructive`, `hf-label`
- Feedback: `hf-banner`, `hf-banner-info`, `hf-banner-warning`, `hf-banner-success`, `hf-banner-error`
- States: `hf-spinner` (blocking), `hf-glow-active` (background), `hf-empty`
- Misc: `hf-list-row`, `hf-icon-box`, `hf-icon-box-lg`, `hf-category-label`, `hf-info-footer`

## Auth Pages (`/login/**`) — `login-*` classes

`login-bg`, `login-card`, `login-form-card`, `login-input`, `login-label`, `login-btn`, `login-btn-secondary`, `login-error`, `login-text`, `login-icon-circle`, `login-footer`, `login-logo`

## Spinner vs Glow

- `hf-spinner` = blocking (user must wait)
- `hf-glow-active` = background (user can continue)
- Never mix on same element

## FieldHint

Every wizard intent field MUST have `<FieldHint>`. Data in `lib/wizard-hints.ts`.

## CSS Rules

- Use CSS custom properties, never hardcoded hex
- Use `color-mix()` for alpha/opacity, never hex suffix (`#fff9`)
- Static visual properties (backgrounds, borders, colors, padding, radius) must be CSS classes
- `style={{}}` only for truly dynamic runtime values (e.g. user-set brand colours)

## Color Map (hex -> CSS var)

| Hex | CSS Variable |
|-----|-------------|
| `#6b7280`, `#9ca3af` | `var(--text-muted)` |
| `#374151`, `#1f2937` | `var(--text-primary)` |
| `#f3f4f6`, `#f9fafb` | `var(--surface-secondary)` |
| `#e5e7eb`, `#d1d5db` | `var(--border-default)` |
| `#fff` | `var(--surface-primary)` |
| `#2563eb`, `#3b82f6` | `var(--accent-primary)` |
| `#ef4444`, `#dc2626` | `var(--status-error-text)` |
| `#10b981`, `#22c55e` | `var(--status-success-text)` |
| `#F5B856` | `var(--login-gold)` |
| `#1F1B4A` | `var(--login-navy)` |
| `#9FB5ED` | `var(--login-blue)` |

After any UI changes, run both:
- `ui-reviewer` agent — mechanical compliance (classes, colors, FieldHint, spinner-vs-glow)
- `ux-reviewer` agent — design quality (empty states, errors, microcopy, educator language, feedback loops)
