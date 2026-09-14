const path = require('node:path');
require('dotenv').config();
const { defineConfig, env } = require('prisma/config');

module.exports = defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
