const express = require('express');
const path = require('path');
const cors = require('cors');
const validateEnv = require('./utils/validateEnv');
require('dotenv').config();

validateEnv(); // Ensure env vars are present

const app = express();

// Middleware
app.use(cors());
app.use(require('./middleware/logger'));

// Static file serving
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', require('./routes/index'));
app.use('/stripe', require('./routes/stripe'));
app.use('/terminal', require('./routes/terminal'));
app.use('/', require('./routes/webhooks')); // Webhooks like /webhook-quotes etc.

app.use(express.json());

// Error Handling
app.use(require('./middleware/errorHandler'));

module.exports = app;
