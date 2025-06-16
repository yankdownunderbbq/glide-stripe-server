const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// === Serve static files from the "public" directory ===
// This allows your HTML test page (for the Stripe Terminal simulator) to load in the browser
app.use(express.static(path.join(__dirname, 'public')));

// === Route to serve the homepage (test UI) ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

//My Stripe endpoint
app.post('/connection-token', async (req, res) => {
  try {
    const connectionToken = await stripe.terminal.connectionTokens.create();
    res.json({ secret: connectionToken.secret });
  } catch (error) {
    console.error('Error creating connection token:', error);
    res.status(500).json({ error: 'Failed to create connection token' });
  }
});

// Endpoint to create a PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
  const { amount, currency, description } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      payment_method_types: ['card_present'], // this is for Terminal!
    });

    res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

//basic route handler
app.get('/', (req, res) => {
  res.send('✅ Stripe server is running!');
});

//Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
