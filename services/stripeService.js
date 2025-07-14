const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const { sendToGlide } = require('./glideService');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const processedPayments = new Set();

// === Webhook: /webhook-quotes ===
async function handleQuoteWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Invalid webhook signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentIntentId = session.payment_intent;
    const quoteId = session.metadata.quote_id;
    const paymentType = session.metadata.payment_mode || 'unspecified';

    if (processedPayments.has(paymentIntentId)) {
      return res.status(200).send('Duplicate event ignored');
    }

    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = pi.charges?.data?.[0];

      processedPayments.add(pi.id);

      const payload = {
        quote_id: quoteId,
        payment_intent_id: pi.id,
        amount_paid: pi.amount_received,
        currency: pi.currency,
        status: pi.status,
        receipt_url: charge?.receipt_url || '',
        paid: pi.status === 'succeeded',
        payment_type: paymentType,
      };

      await sendToGlide(payload, 'quote');
      return res.status(200).send('Webhook processed');
    } catch (err) {
      console.error('❌ Failed to process quote payment:', err.message);
      return res.status(500).send('Internal error');
    }
  }

  res.status(200).send('Event ignored');
}

// === Webhook: /webhook-terminal ===
async function handleTerminalWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_TERMINAL_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('📬 Terminal webhook received:', event.type);
  } catch (err) {
    console.error('❌ Terminal webhook signature invalid:', err.message);
    return res.sendStatus(400);
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailure(event.data.object);
      break;

    case 'payment_intent.canceled':
      await handlePaymentCanceled(event.data.object);
      break;

    case 'terminal.reader.action_failed':
      await handleReaderError(event.data.object);
      break;

    default:
      console.log(`Unhandled terminal event: ${event.type}`);
  }

  res.sendStatus(200);
}

// === /terminal-charge ===
async function chargeTerminal(req, res) {
  const { order_id, quote_id, amount, reader_id, attempt_number, session_patch_id } = req.body;

  if (session_patch_id !== process.env.GLIDE_SHARED_SECRET) {
    return res.status(403).json({ error: 'Unauthorized request — invalid secret' });
  }

  if (!order_id || !amount || !reader_id || !attempt_number) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: 'aud',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        order_id,
        quote_id,
        attempt_number: attempt_number.toString(),
        payment_type: 'terminal',
      },
    }, {
      idempotencyKey: `terminal-charge-${order_id}-${attempt_number}`,
    });

    const result = await stripe.terminal.readers.processPaymentIntent(reader_id, {
      payment_intent: paymentIntent.id,
    });

    return res.status(200).json({
      paymentIntentId: paymentIntent.id,
      result,
    });
  } catch (err) {
    console.error('❌ Terminal charge failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// === /terminal-cancel ===
async function cancelTerminalAction(req, res) {
  const { reader_id, session_patch_id } = req.body;

  if (session_patch_id !== process.env.GLIDE_SHARED_SECRET) {
    return res.status(403).json({ error: 'Unauthorized request — invalid secret' });
  }

  if (!reader_id) {
    return res.status(400).json({ error: 'Missing reader_id' });
  }

  try {
    const result = await stripe.terminal.readers.cancelAction(reader_id);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('❌ Failed to cancel reader action:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// === /refund-stripe ===
async function refundPaymentIntent(req, res) {
  const { payment_intent_id, refund_amount, refund_reason, timestamp } = req.body;

  if (!payment_intent_id || !refund_amount) {
    return res.status(400).json({ error: 'Missing payment_intent_id or refund_amount' });
  }

  try {
    const refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      amount: parseInt(refund_amount),
    });

    const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
    const metadata = pi.metadata || {};

    const payload = {
      status: 'refunded',
      paid: false,
      currency: refund.currency,
      amount_paid: -Math.abs(refund.amount),
      receipt_url: refund.receipt_url,
      payment_intent_id: refund.payment_intent,
      refund_reason: refund_reason || refund.reason || 'unspecified',
      stripe_refund_id: refund.id,
      payment_type: metadata.payment_type || 'terminal',
      attempt_number: parseInt(metadata.attempt_number || '1', 10),
      source: metadata.order_id ? 'order' : 'quote',
      quote_id: metadata.quote_id || null,
      order_id: metadata.order_id || null,
      timestamp: timestamp || new Date().toISOString(),
    };

    await sendToGlide(payload, 'terminal');
    return res.status(200).json({ success: true, refund_id: refund.id });
  } catch (err) {
    console.error('❌ Stripe refund failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// === Helpers for Terminal Webhook Events ===
async function handlePaymentSuccess(paymentIntent) {
  if (processedPayments.has(paymentIntent.id)) {
    console.log('🔁 Duplicate success detected — skipping', paymentIntent.id);
    return;
  }
  processedPayments.add(paymentIntent.id);
    
  const metadata = paymentIntent.metadata || {};

  const payload = {
    status: 'succeeded',
    paid: true,
    currency: paymentIntent.currency,
    amount_paid: paymentIntent.amount_received,
    receipt_url: paymentIntent.charges?.data[0]?.receipt_url || null,
    payment_intent_id: paymentIntent.id,
    payment_type: metadata.payment_type || 'terminal',
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: metadata.order_id ? 'order' : 'quote',
    quote_id: metadata.quote_id || null,
    order_id: metadata.order_id || null,
    timestamp: new Date().toISOString(),
  };

  await sendToGlide(payload, 'terminal');
}

async function handlePaymentFailure(paymentIntent) {
    if (processedPayments.has(paymentIntent.id)) {
    console.log('🔁 Duplicate failure detected — skipping', paymentIntent.id);
    return;
  }
  processedPayments.add(paymentIntent.id);
  const metadata = paymentIntent.metadata || {};

  const payload = {
    status: 'failed',
    paid: false,
    currency: paymentIntent.currency,
    amount_paid: 0,
    receipt_url: null,
    payment_intent_id: paymentIntent.id,
    failure_reason: paymentIntent.last_payment_error?.message || 'Unknown reason',
    failure_code: paymentIntent.last_payment_error?.code || 'unknown_error',
    payment_type: metadata.payment_type || 'terminal',
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: metadata.order_id ? 'order' : 'quote',
    quote_id: metadata.quote_id || null,
    order_id: metadata.order_id || null,
    timestamp: new Date().toISOString(),
  };

  await sendToGlide(payload, 'terminal');
}

async function handlePaymentCanceled(paymentIntent) {
    if (processedPayments.has(paymentIntent.id)) {
    console.log('🔁 Duplicate cancellation detected — skipping', paymentIntent.id);
    return;
  }
  processedPayments.add(paymentIntent.id);
  const metadata = paymentIntent.metadata || {};

  const payload = {
    status: 'canceled',
    paid: false,
    currency: paymentIntent.currency,
    amount_paid: 0,
    receipt_url: null,
    payment_intent_id: paymentIntent.id,
    payment_type: metadata.payment_type || 'terminal',
    attempt_number: parseInt(metadata.attempt_number || '1', 10),
    source: metadata.order_id ? 'order' : 'quote',
    quote_id: metadata.quote_id || null,
    order_id: metadata.order_id || null,
    timestamp: new Date().toISOString(),
  };

  await sendToGlide(payload, 'terminal');
}

async function handleReaderError(reader) {
  const failure = reader.action?.failure_message || 'Unknown error';
  const failureCode = reader.action?.failure_code || 'unknown_error';
  const paymentIntentId = reader.action?.process_payment_intent?.payment_intent;

  console.warn('🚨 Terminal reader error:', {
    reader_id: reader.id,
    failureCode,
    failure,
  });

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      await handlePaymentFailure(pi);
    } catch (err) {
      console.error('❌ Failed to retrieve payment intent for reader error:', err.message);
    }
  }
}

module.exports = {
  handleQuoteWebhook,
  handleTerminalWebhook,
  chargeTerminal,
  cancelTerminalAction,
  refundPaymentIntent,
};
