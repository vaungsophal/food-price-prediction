import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The engine is deliberately free of Nitro and Vue imports, so the suite needs no
    // Nuxt environment — it reads the shipped artifacts straight off disk.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
