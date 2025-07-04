const express = require('express');
const router = express.Router();
const terminalService = require('../services/stripeService');

router.post('/terminal-charge', express.json(), terminalService.chargeTerminal);
router.post('/terminal-cancel', express.json(), terminalService.cancelTerminalAction);
router.post('/refund-stripe', express.json(), terminalService.refundPaymentIntent);

module.exports = router;
