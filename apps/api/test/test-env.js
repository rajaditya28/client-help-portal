/**
 * The test database is derived from DATABASE_URL by suffixing the db name with "_test",
 * so tests never touch dev data. Override with TEST_DATABASE_URL.
 */
const { existsSync } = require('node:fs');
const { join } = require('node:path');

function testDatabaseUrl() {
  const envFile = join(__dirname, '..', '.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return url.toString();
}

module.exports = { testDatabaseUrl };
