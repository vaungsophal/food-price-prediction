/**
 * `server-only` throws when imported outside a React Server Component graph, which is
 * exactly its job in the app and exactly wrong under Vitest. Aliased to this no-op so the
 * modules that guard themselves with it can still be unit tested.
 */
export {}
