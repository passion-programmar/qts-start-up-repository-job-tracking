# SB Admin Header Integration Plan for QTS

## Status

The production header is live. The sidebar user/logout block and repeated header
wordmark have been removed; logout remains available in the header account menu.

## Goal

Adapt the visual language and useful header controls from the local SB Admin
theme at `startbootstrap-sb-admin-gh-pages/` for QTS's authenticated web
panels, while keeping QTS's existing Next.js, React, Ant Design, navigation,
authentication, and role-based access behavior.

The theme is a visual reference, not a framework or a page template to copy
wholesale. Its current header is in `startbootstrap-sb-admin-gh-pages/index.html`.
QTS's shared panel shell is `admin-web/src/components/PanelShell.tsx`, wrapped
by `admin-web/src/components/PanelLayout.tsx`.

## Proposed scope

Update the shared header/top bar used by the Admin, Manager, Account, and Caller
authenticated panels. The header should:

- Let the existing QTS logo in the sidebar provide branding; do not repeat a
  QTS wordmark in the header.
- Keep the existing menu button and sidebar expand/collapse behavior.
- Present the current page title consistently for every panel role.
- Preserve the existing API connection indicator.
- Provide a compact signed-in-user menu showing the current username and role,
  with links/actions wired to existing QTS profile/settings and logout
  behavior. Remove the duplicate username/role and Log Out block from the
  sidebar footer; logout remains available in the account menu.
- Use responsive styling consistent with QTS's current mobile navigation.

The first implementation should not add an inactive or misleading search
field. SB Admin's search field is a visual placeholder here: QTS does not yet
have a confirmed global search behavior or endpoint in the shared shell.
Search can be considered separately once its intended data and navigation
behavior are defined.

## Existing behavior to preserve

- `PanelShell` filters sidebar navigation by panel mode and, where applicable,
  authenticated user role.
- Sidebar navigation targets are prefixed with the current role's base path.
- The menu button toggles the desktop sidebar and opens/closes the mobile
  navigation overlay.
- Mobile navigation closes after route changes and when moving back to a
  desktop viewport.
- The top bar reports API health as Connected or Offline.
- QTS authentication owns the current user and logout behavior; the header
  must not create a second authentication state or use placeholder theme links.
- Account, Manager, Admin, and Caller notices, page content, and permissions
  remain unchanged.

## Implementation outline

### 1. Confirm shared-shell states

Before editing, inspect the current `PanelShell` rendering and role-specific
routes, including `/settings`, for each supported panel. Confirm how page
titles are derived and how `useAuth()` exposes the user, role, and logout
action. Keep the integration in the shared shell unless inspection identifies
a genuine role-specific difference.

### 2. Adapt the React header

In `admin-web/src/components/PanelShell.tsx`:

- Keep the existing sidebar toggle control and its accessibility state.
- Render the page title for all panel modes, using the existing title mapping
  and route resolution.
- Add a semantic account-menu control based on QTS's current user and role.
- Wire "My Profile" to the existing role-scoped settings route and "Log Out"
  to the existing `logout()` function.
- Preserve the existing connection state and label.
- Avoid introducing new authentication requests or placeholder menu actions.

Use existing project UI conventions and dependencies. Do not copy static
Bootstrap HTML, add Bootstrap JavaScript/CSS, or add a CDN dependency.

### 3. Style the header without changing the theme globally

Update the shared panel styles in `admin-web/src/styles/panel.css` and, only
where needed for narrow viewports, `admin-web/src/styles/responsive.css`.
Scope new styles to the panel header and its controls. Reuse existing QTS
design tokens, focus styling, and breakpoints where practical. Do not import
the theme's global styles or alter styles for unrelated pages and components.

Adapt relevant SB Admin ideas—sidebar-based branding, aligned controls, compact
spacing, and a user dropdown—rather than duplicating Bootstrap class names or
its exact implementation.

### 4. Keep the existing shell's visual and interaction states coherent

Check the header when the sidebar is expanded and collapsed; on desktop,
tablet, and mobile widths; with long usernames and page titles; and when the
API is connected or offline. Ensure the account menu can be opened and
dismissed without obscuring the mobile navigation or clipping outside the
viewport.

## Accessibility and responsive requirements

- Use semantic header/navigation elements or equivalent accessible landmarks.
- All interactive controls must be keyboard reachable and have clear accessible
  names.
- Expose menu state with `aria-expanded` and an association with its menu.
- Support Escape to dismiss the account menu and restore focus to its trigger,
  if that behavior is implemented using a custom menu.
- Provide visible focus indicators and maintain sufficient contrast.
- Do not rely on hover alone to reveal user actions.
- At mobile widths, keep the existing menu toggle reachable and prevent the
  title, status, and account control from overlapping or forcing horizontal
  scrolling.
- Respect reduced-motion preferences if the new UI introduces transitions.

## Out of scope

- Replacing the QTS sidebar, role-based navigation, dashboards, or page layouts
  with SB Admin pages.
- Adding Bootstrap, Font Awesome, Simple DataTables, or other theme runtime
  dependencies.
- Building a global search feature or connecting a search box to API data.
- Changing authentication, authorization, API endpoints, database schema, or
  session persistence.
- Applying theme changes to the separately distributed Chrome extension.
- Changing deployment configuration or promoting a release to Production.

## Validation plan

Run checks from `admin-web` after implementation:

1. Run the web app lint script (`npm run lint`).
2. Run the Next.js production build (`npm run build`) to verify compilation and
   type checking.
3. If the repository has suitable component or browser tests, add or update
   focused coverage for page title, role-aware profile route, logout action,
   menu open/close behavior, and responsive navigation preservation.
4. Otherwise, manually verify Admin, Manager, Account, and Caller sessions,
   including `/settings`, keyboard use, narrow viewport behavior, and online
   and offline status.
5. Review the final diff and run `git diff --check`.

Acceptance criteria:

- Every authenticated panel displays a coherent QTS-branded header.
- The sidebar toggle, active role-scoped navigation, page content, status
  indicator, and logout still work as before.
- Profile/settings navigation resolves to the current role's own settings
  page.
- The account menu works with keyboard and pointer input and remains usable on
  mobile.
- No Bootstrap/theme runtime is introduced, and there are no unrelated UI or
  API changes.
- Lint and production build pass; any unrelated baseline failures are reported
  separately.

## Files expected to change during implementation

- `admin-web/src/components/PanelShell.tsx` — shared header structure and menu
  behavior.
- `admin-web/src/styles/panel.css` — scoped desktop/header styling.
- `admin-web/src/styles/responsive.css` — responsive header adjustments if
  required.
- Relevant existing tests, if available for the shared shell.

This plan document is the only file created for the planning request.

## Deployment boundary

This is a web UI change in `admin-web`. If implemented and approved later, it
should be validated in a Vercel Preview before any production deployment.
Do not deploy with the Vercel CLI, promote a Preview, or push to a production
branch as part of implementing the UI change without explicit authorization.
The Chrome extension is separately distributed and is not updated by a web
deployment.
