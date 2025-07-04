const express = require('express');
const bodyParser = require('body-parser');
const stripeService = require('../services/stripeService');

const router = express.Router();

router.post('/webhook-quotes', bodyParser.raw({ type: 'application/json' }), stripeService.handleQuoteWebhook);
router.post('/webhook-terminal', bodyParser.raw({ type: 'application/json' }), stripeService.handleTerminalWebhook);

module.exports = router;
