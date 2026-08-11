/**
 * Bootstrap for scrape job child under Node 22+/24.
 *
 * Native type-stripping loads `.ts` as ESM and breaks extensionless imports
 * (`import '../logger'` → ERR_MODULE_NOT_FOUND). Force CommonJS via ts-node
 * with the server tsconfig, and disable Node strip-types.
 */
const path = require('path');

process.env.TS_NODE_TRANSPILE_ONLY = '1';
process.env.TS_NODE_PROJECT =
  process.env.TS_NODE_PROJECT || path.join(__dirname, '..', '..', 'tsconfig.json');

require('ts-node/register/transpile-only');
require('./scrapeJobChild.ts');
