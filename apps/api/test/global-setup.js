const { execSync } = require('node:child_process');
const { join } = require('node:path');
const { testDatabaseUrl } = require('./test-env');

/** Brings the test database to the latest migration once per test run (creates it if missing). */
module.exports = async () => {
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
};
