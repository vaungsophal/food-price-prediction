/**
 * Loads the model artifacts and hands back a memoised {@link Engine}.
 *
 * The four JSON files live in `server/assets/artifacts/` and are read through
 * `useStorage('assets:server')` rather than imported directly. Two reasons:
 *
 *  - A direct `import ... from './artifacts/model.json'` makes rollup inline 2.4 MB of
 *    numbers as a JavaScript object literal in the server chunk. It does survive the
 *    build, but the literal has to be parsed by V8 on every cold start, and it sits in
 *    the chunk whether or not a request ever needs it.
 *  - Nitro's server-asset pipeline is the documented way to ship raw files into the
 *    build output, so there's no bundler behaviour to guess at across presets.
 *
 * Loading is deferred to the first request and cached on the module, so a warm Vercel
 * invocation pays nothing.
 */

import type { Artifacts, Encoders, History, ModelArtifact } from './engine'
import { Engine } from './engine'

/** Server assets arrive as raw text on some presets and pre-parsed on others. */
async function readArtifact<T>(key: string): Promise<T> {
  const raw = await useStorage('assets:server').getItem<T | string>(`artifacts:${key}`)
  if (raw === null || raw === undefined) {
    throw new Error(`Model artifact "${key}" is missing from the build output.`)
  }
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : raw
}

let engine: Promise<Engine> | undefined

export function usePredictor(): Promise<Engine> {
  engine ??= (async () => {
    const [model, encoders, featureCols, history] = await Promise.all([
      readArtifact<ModelArtifact>('model.json'),
      readArtifact<Encoders>('encoders.json'),
      readArtifact<string[]>('feature_cols.json'),
      readArtifact<History>('history.json'),
    ])
    return new Engine({ model, encoders, featureCols, history } satisfies Artifacts)
  })().catch((error) => {
    // Don't cache a failed load — a transient storage error shouldn't poison the process.
    engine = undefined
    throw error
  })

  return engine
}
