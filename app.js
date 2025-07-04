require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const validateEnv = require('./utils/validateEnv');

validateEnv(); // Ensure env vars are present

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(require('./middleware/logger'));

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', require('./routes/index'));
app.use('/stripe', require('./routes/stripe'));
app.use('/terminal', require('./routes/terminal'));
app.use('/', require('./routes/webhooks')); // Webhooks like /webhook-quotes etc.

// Error Handling
app.use(require('./middleware/errorHandler'));

module.exports = app;
