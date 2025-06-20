const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const path = require('path');
const processedPayments = new Set();
const { v4: uuidv4 } = require('uuid'); 
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle completed payment
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const paymentIntentId = session.payment_intent;
      const quoteId = session.metadata.quote_id;
      const paymentType = session.metadata.payment_mode || 'unspecified';

      if (processedPayments.has(paymentIntent.id)) {
  console.log('🔁 Duplicate payment detected — skipping');
  res.status(200).send('Duplicate event ignored');
  return;
}

processedPayments.add(paymentIntent.id);

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = paymentIntent.charges?.data?.[0];

      // Send to Glide
      await fetch('https://go.glideapps.com/api/container/plugin/webhook-trigger/66t6tyCZFBicTWiSdBmK/a994a439-e558-4b2c-bf0f-0332482b2bf1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 
                   'Idempotency-Key': uuidv4() // One-off unique key
                 },
        body: JSON.stringify({
          quote_id: quoteId,
          payment_intent_id: paymentIntent.id,
          amount_paid: paymentIntent.amount_received,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          receipt_url: charge?.receipt_url || '',
          paid: paymentIntent.status === 'succeeded',
          payment_type: paymentType
        })
      });

      console.log('✅ Payment recorded and sent to Glide');

      res.status(200).send('Webhook processed');
      return;
    } catch (err) {
      console.error('❌ Failed to process payment or send to Glide:', err.message);
      res.status(500).send('Internal error');
      return;
    }
  } else {
    res.status(200).send('Ignored event');
  }

  res.status(200).send('Received');
}); 

app.use(cors());
app.use(express.json());

app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// === Serve static files from the "public" directory ===
// This allows your HTML test page (for the Stripe Terminal simulator) to load in the browser
app.use(express.static(path.join(__dirname, 'public')));

// === Route to serve the homepage (test UI) ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/pay', async (req, res) => {
  const { quote_id, amount, mode } = req.query;

  // Validate input
  if (!quote_id || !amount || !mode) {
    return res.status(400).send('Missing required parameters');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud', // or change if you're not in Australia
          product_data: {
            name: mode === 'deposit' ? 'Deposit Payment' : 'Full Catering Payment',
          },
          unit_amount: parseInt(amount), // cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      metadata: {
        quote_id,
        payment_mode: mode
      },
      success_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quoteId}`, 
      cancel_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quoteId}`,  
    });

    res.redirect(session.url);
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).send('Something went wrong creating a payment session.');
  }
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
//app.get('/', (req, res) => {
//  res.send('✅ Stripe server is running!');
//});

//Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
