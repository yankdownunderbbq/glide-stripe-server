const axios = require('axios'); // Make sure axios is installed
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const path = require('path');
const processedPayments = new Set();
const { v4: uuidv4 } = require('uuid'); 
const bodyParser = require('body-parser');
const { verifyGlideAuth } = require('./authMiddleware');
require('dotenv').config();

app.use(express.json());

const GLIDE_QUOTE_WEBHOOK_URL = process.env.GLIDE_QUOTE_WEBHOOK_URL;
const GLIDE_TERMINAL_WEBHOOK_URL = process.env.GLIDE_TERMINAL_WEBHOOK_URL;

const GLIDE_QUOTE_WEBHOOK_TOKEN = process.env.GLIDE_QUOTE_WEBHOOK_TOKEN;
const GLIDE_TERMINAL_WEBHOOK_TOKEN = process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN;

function sendToGlide(payload, type = 'quote') {
  console.log('sendToGlide called');
  const url =
    type === 'terminal'
      ? process.env.GLIDE_TERMINAL_WEBHOOK_URL
      : process.env.GLIDE_QUOTE_WEBHOOK_URL;

  const token =
    type === 'terminal'
      ? process.env.GLIDE_TERMINAL_WEBHOOK_TOKEN
      : process.env.GLIDE_QUOTE_WEBHOOK_TOKEN;

  //debug logs
  console.log('📡 Glide webhook URL:', url);
console.log('🔐 Glide token:', token ? 'Present ✅' : 'Missing ❌');

  return axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

app.post('/webhook-quotes', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
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
        headers: { 'Content-Type': 'axpplication/json', 
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

app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

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

app.use((req, res, next) => {
  console.log(`📡 Received request: ${req.method} ${req.originalUrl}`);
  next();
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
app.post('/terminal-charge', verifyGlideAuth, async (req, res) => {
  console.log('📦 Incoming req.body:', req.body);
 
  const payload = req.body.body || req.body;
  const { order_id, amount, reader_id, attempt_number } = payload;

  if (!order_id || !amount || !reader_id || !attempt_number === undefined) {
    return res.status(400).json({ error: 'Missing order_id, amount, reader_id, or attempt_number' });
  }

  try {
    // 1. Create the PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: 'aud',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: { 
        order_id,
        attempt_number: attempt_number.toString(), //store as string for safety
        payment_type: 'terminal'
      }
    }, {
      idempotencyKey: `terminal-charge-${order_id}-${attempt_number}`
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

// Add raw body middleware ONLY for this route
  app.post('/webhook-terminal', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_TERMINAL_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      endpointSecret
    );
    console.log('📬 Received event:', event.type);
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

app.use(cors());
app.use(express.json());

// Replace with your real Glide-trigger webhook URL
//HOOK_URL = 'https://go.glideapps.com/api/container/plugin/webhook-trigger/66t6tyCZFBicTWiSdBmK/6d579e4a-8c20-48f1-a6fa-361be0cbd0e3';

function handlePaymentSuccess(paymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const isQuote = !!metadata.quote_id;
  const isOrder = !!metadata.order_id;

  const payload = {
    status: 'succeeded',
    paid: true,
    currency: paymentIntent.currency,
    amount_paid: paymentIntent.amount_received,
    receipt_url: paymentIntent.charges?.data[0]?.receipt_url || null,
    payment_intent_id: paymentIntent.id,
    payment_type: metadata.payment_type || (isOrder ? 'terminal' : 'full'),
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: isQuote ? 'quote' : 'order',
    quote_id: isQuote ? metadata.quote_id : null,
    order_id: isOrder ? metadata.order_id : null,
    timestamp: new Date().toISOString()
  };

sendToGlide(payload, 'terminal')
  .then(() => console.log(`✅ Sent success to Glide for order: ${payload.order_id}`))
  .catch(err => console.error('❌ Failed to send success to Glide:', err.message));
}

function handlePaymentFailure(paymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const isQuote = !!metadata.quote_id;
  const isOrder = !!metadata.order_id;

  const failureReason = paymentIntent.last_payment_error?.message || 'Unknown reason';
  const failureCode = paymentIntent.last_payment_error?.code || 'unknown_error';

  const payload = {
    status: 'failed',
    paid: false,
    currency: paymentIntent.currency,
    amount_paid: 0,
    receipt_url: null,
    payment_intent_id: paymentIntent.id,
    failure_reason: failureReason,
    failure_code: failureCode,
    payment_type: metadata.payment_type || (isOrder ? 'terminal' : 'full'),
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: isQuote ? 'quote' : 'order',
    quote_id: isQuote ? metadata.quote_id : null,
    order_id: isOrder ? metadata.order_id : null,
    timestamp: new Date().toISOString()
  };

 sendToGlide(payload, 'terminal')
  .then(response => {
    console.log('✅ Glide webhook success:', response.data);
  })
  .catch(err => {
    console.error('❌ Glide webhook error:', err.response?.data || err.message);
  });
}

function handlePaymentCanceled(paymentIntent) {
  const metadata = paymentIntent.metadata || {};
  const isQuote = !!metadata.quote_id;
  const isOrder = !!metadata.order_id;

  const payload = {
    status: 'canceled',
    paid: false,
    currency: paymentIntent.currency,
    amount_paid: 0,
    receipt_url: null,
    payment_intent_id: paymentIntent.id,
    payment_type: metadata.payment_type || (isOrder ? 'terminal' : 'full'),
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: isQuote ? 'quote' : 'order',
    quote_id: isQuote ? metadata.quote_id : null,
    order_id: isOrder ? metadata.order_id : null,
    timestamp: new Date().toISOString()
  };

  sendToGlide(payload, 'terminal')
  .then(() => console.log(`✅ Sent cancellation to Glide for order: ${payload.order_id}`))
  .catch(err => console.error('❌ Failed to send cancellation to Glide:', err.message));
}

function handleReaderError(data) {
  console.log('🚨 Terminal reader error:', data);
  // You could optionally notify Glide or store logs elsewhere
}

app.use((req, res, next) => {
  console.warn(`❗ 404 - Unknown route hit: ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not Found');
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
