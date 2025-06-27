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

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = paymentIntent.charges?.data?.[0];

      if (processedPayments.has(paymentIntent.id)) {
        console.log('🔁 Duplicate payment detected — skipping');
        res.status(200).send('Duplicate event ignored');
        return;
}

processedPayments.add(paymentIntent.id);

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
      success_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quote_id}`, 
      cancel_url: `https://yankdownunderbbq.glide.page/dl/ab0312?id=${quote_id}`,  
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


// ✅ This endpoint is used to create a PaymentIntent for a card_present payment (Stripe Terminal).
// It immediately sends the PaymentIntent to a specified reader (e.g., WisePOS E) to collect payment.
// Triggered by Glide via webhook when an order is ready to be paid by card in-person.
app.post('/terminal-charge', async (req, res) => {
  const { order_id, amount, reader_id } = req.body;

  if (!order_id || !amount || !reader_id) {
    return res.status(400).json({ error: 'Missing order_id, amount, or reader_id' });
  }

  try {
    // 1. Create the PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: 'aud',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { order_id }
    });

    console.log(`✅ Created PaymentIntent: ${paymentIntent.id}`);

    // 2. Start the payment on the specified reader
    const result = await stripe.terminal.readers.processPaymentIntent(reader_id, {
      payment_intent: paymentIntent.id
    });

    console.log(`🖥️ Sent payment to reader (${reader_id}):`, result.status);

    res.status(200).json({
      paymentIntentId: paymentIntent.id,
      result: result
    });
  } catch (err) {
    console.error('❌ Terminal charge failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// This should already be set at the top
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Add raw body middleware ONLY for this route
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.sendStatus(400);
  }

  // Handle different event types
  switch (event.type) {
    case 'payment_intent.succeeded':
      handlePaymentSuccess(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      handlePaymentFailure(event.data.object);
      break;

    case 'payment_intent.canceled':
      handlePaymentCanceled(event.data.object);
      break;

    case 'terminal.reader.action_failed':
      handleReaderError(event.data.object);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.sendStatus(200);
});

function handlePaymentSuccess(paymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  console.log(`✅ Payment successful for order ${orderId}`);
  // TODO: update Glide or DB
}

function handlePaymentFailure(paymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  const reason = paymentIntent.last_payment_error?.message;
  console.log(`❌ Payment failed for order ${orderId}: ${reason}`);
}

function handlePaymentCanceled(paymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  console.log(`⚠️ Payment canceled for order ${orderId}`);
}

function handleReaderError(data) {
  console.log('🚨 Terminal reader error:', data);
}

//basic route handler
//app.get('/', (req, res) => {
//  res.send('✅ Stripe server is running!');
//});

//Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
