---
name: vue-pinia-best-practices
description: "Pinia stores, state management patterns, store setup, and reactivity with stores."
license: MIT
metadata:
  author: github.com/vuejs-ai
  version: "1.0.0"
---

Pinia best practices, common gotchas, and state management patterns.

### PULSO version context
PULSO currently uses Pinia 4.1.0 and its required `@vue/devtools-api` peer is installed at 8.2.1. Recheck installed versions when a task depends on version-specific behavior; do not assume the missing-peer finding from an earlier inspection is still current. Use the store/reactivity principles here and verify setup against current Pinia 4 documentation. Do not change application manifests during skill setup.

### Store Setup
- Getting "getActivePinia was called" error at startup → See [pinia-no-active-pinia-error](reference/pinia-no-active-pinia-error.md)
- Setup stores missing state in DevTools or SSR → See [pinia-setup-store-return-all-state](reference/pinia-setup-store-return-all-state.md)

### Reactivity
- Store destructuring stops updating UI reactively → See [pinia-store-destructuring-breaks-reactivity](reference/pinia-store-destructuring-breaks-reactivity.md)
- Store methods lose context in template calls → See [store-method-binding-parentheses](reference/store-method-binding-parentheses.md)

### State Patterns
- Filters reset on refresh or can't be shared → See [state-url-for-ephemeral-filters](reference/state-url-for-ephemeral-filters.md)
- Building production app without DevTools or conventions → See [state-use-pinia-for-large-apps](reference/state-use-pinia-for-large-apps.md)
