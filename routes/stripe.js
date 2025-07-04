const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// GET /pay
router.get('/pay', async (req, res) => {
  const { quote_id, amount, mode } = req.query;

  if (!quote_id || !amount || !mode) {
    return res.status(400).send('Missing required parameters');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: mode === 'deposit' ? 'Deposit Payment' : 'Full Catering Payment',
          },
          unit_amount: parseInt(amount),
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: {
        quote_id,
        payment_mode: mode,
      },
      success_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quote_id}`,
      cancel_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quote_id}`,
    });

    res.redirect(session.url);
  } catch (err) {
    console.error('❌ Stripe Checkout session error:', err.message);
    res.status(500).send('Could not create session');
  }
});

// POST /connection-token
router.post('/connection-token', async (req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (err) {
    console.error('❌ Failed to create connection token:', err.message);
    res.status(500).json({ error: 'Failed to create connection token' });
  }
});

// POST /create-payment-intent
router.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, description } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      payment_method_types: ['card_present'],
    });

    res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error('❌ Payment intent creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

module.exports = router;
