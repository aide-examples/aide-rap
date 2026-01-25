#!/usr/bin/env node
/**
 * Generate bcrypt password hash for AIDE RAP authentication
 *
 * Usage:
 *   node app/tools/generate-password-hash.js <password>
 *
 * Example:
 *   node app/tools/generate-password-hash.js mysecretpassword
 *   # Output: $2b$10$xYz...
 *
 * Copy the output hash to your system's config.json:
 *   {
 *     "auth": {
 *       "passwords": {
 *         "admin": "<paste hash here>",
 *         "user": "",
 *         "guest": ""
 *       }
 *     }
 *   }
 */

const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node generate-password-hash.js <password>');
    console.error('');
    console.error('Example:');
    console.error('  node app/tools/generate-password-hash.js admin123');
    process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(hash);
