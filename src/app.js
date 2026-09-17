const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const { corsOrigins } = require('./config/env');

const app = express();

// El frontend corre en otro origen (Vite en :5173), asi que sin esto el
// navegador bloquea toda peticion. "*" solo si CORS_ORIGIN quedo vacio.
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
