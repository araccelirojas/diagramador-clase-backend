const bcrypt = require('bcryptjs');
const { bcryptRounds } = require('../config/env');

async function hash(plain) {
  return bcrypt.hash(plain, bcryptRounds);
}

async function compare(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = { hash, compare };
