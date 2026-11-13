const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { testDatabaseUrl } = require('./test-env');

// Set before the app module loads: env vars already present win over .env.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
process.env.JOBS_ENABLED = 'false'; // tests drive state directly; no background worker
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'hp-test-storage-'));
process.env.DEEPGRAM_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
