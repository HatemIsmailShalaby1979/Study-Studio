module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1'
  },
  testMatch: [
    '<rootDir>/src/**/*.test.{ts,tsx}'
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    // Only the route shells are excluded, and only the ones with no suite.
    // This used to be a blanket `!src/app/**/*.tsx`, which hid real components
    // colocated under src/app — `LessonContent.tsx` (917 lines, covered by its
    // own suite) and `library/page.tsx` (covered by library.test.tsx) were both
    // invisible in the report, so a refactor could have gutted them without the
    // coverage gate noticing. Page/layout shells are thin wrappers around the
    // components under test, so they stay out.
    '!src/app/**/page.tsx',
    '!src/app/**/layout.tsx'
  ],
  coverageReporters: ['text', 'json-summary', 'lcov'],
  coverageThreshold: {
    // Ratcheted from a single 25% global gate that sat 30 points below reality
    // and could not detect any realistic regression.
    //
    // Measured when written: 57.66 stmts / 45.50 branch / 49.29 funcs / 58.07
    // lines. The floors sit a couple of points under that, so ordinary
    // refactoring does not trip them while a genuine loss of coverage does.
    //
    // IMPORTANT — this `global` key must stay the ONLY key here.
    //
    // Jest does not treat `global` as "all files". Reading CoverageReporter.js,
    // each covered file is first matched against every non-global key, and only
    // files matching NONE of them are tossed into the global bucket:
    //
    //     if (pathOrGlobMatches.length > 0) return files.concat(pathOrGlobMatches);
    //     // Neither a glob or a path? Toss it in global if there's a global threshold:
    //     if (thresholdGroups.indexOf('global') > -1) { ... }
    //
    // So adding `src/lib/**` and `src/components/**` leaves `global` holding
    // only the files outside those two globs — which here was a single
    // 0%-covered hooks file. Jest then reported "global threshold not met: 0%"
    // while the real global figure was 57.66%.
    //
    // Per-directory floors are therefore enforced by scripts/check-coverage.mjs
    // (run via `npm run check:coverage`), which reads coverage-summary.json,
    // checks each directory against an explicit floor, and — unlike Jest —
    // also *reports* directories that have no floor yet, so a gap cannot hide.
    global: {
      branches: 43,
      functions: 47,
      lines: 55,
      statements: 55
    }
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        target: 'es2015',
        esModuleInterop: true,
        jsx: 'react-jsx'
      }
    }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  modulePathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/dist/',
    '<rootDir>/src-tauri/'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/src-tauri/'
  ],
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ]
};
