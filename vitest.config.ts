import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['dist/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/strategy/**/*.ts',
        'src/engine/riskmanager.ts',
        'src/services/encryption.ts',
        'src/http/middleware/**/*.ts',
        'src/cache/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 75,
      },
    },
  },
})
