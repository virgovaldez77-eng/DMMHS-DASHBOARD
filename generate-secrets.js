#!/usr/bin/env node
/**
 * Generate cryptographically secure secrets for .env
 * Usage: node scripts/generate-secrets.js
 */
const crypto = require('crypto');

const jwt = crypto.randomBytes(32).toString('hex');
const session = crypto.randomBytes(32).toString('hex');

console.log('# Add these to your .env file (64 characters each):\n');
console.log(`JWT_SECRET=${jwt}`);
console.log(`SESSION_SECRET=${session}`);
console.log('\n# Optional rotation (after changing JWT_SECRET):');
console.log('# JWT_SECRET_PREVIOUS=<old-jwt-secret>');
