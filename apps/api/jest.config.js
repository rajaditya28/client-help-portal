/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { warnOnly: false } }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // e2e tests boot the real app against a separate database (see test/setup-env.js).
  setupFiles: ['<rootDir>/test/setup-env.js'],
  globalSetup: '<rootDir>/test/global-setup.js',
  testTimeout: 30000,
};
