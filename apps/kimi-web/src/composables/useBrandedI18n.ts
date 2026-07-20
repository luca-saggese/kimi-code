// apps/kimi-web/src/composables/useBrandedI18n.ts
// Thin wrapper around vue-i18n that auto-supplies {brand}, {brandShort},
// {daemonName} interpolation values so callers don't have to pass them.
//
// Usage: replace `useI18n()` with `useBrandedI18n()` in any component that
// uses brand-templated translation keys.

import { useI18n } from 'vue-i18n';
import { brandI18nVars } from '../i18n';

export function useBrandedI18n() {
  const { t: rawT, ...rest } = useI18n();

  function t(key: any, ...args: any[]): any {
    const named = brandI18nVars();

    if (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
      // Merge brand values into the named-values object (user values win)
      return (rawT as any)(key, { ...named, ...args[0] }, ...args.slice(1));
    }
    // No named-values arg supplied: inject brand values
    return (rawT as any)(key, named);
  }

  return { t, ...rest };
}
