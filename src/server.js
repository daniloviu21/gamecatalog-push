
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const webPush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const subscriptionsPath = path.join(__dirname, '../subscriptions.json');

app.use(cors({
  origin: [
    'http://localhost:8080',
    'http://localhost:4200'
  ]
}));

app.use(express.json());

webPush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function getSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(subscriptionsPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveSubscriptions(subscriptions) {
  fs.writeFileSync(
    subscriptionsPath,
    JSON.stringify(subscriptions, null, 2)
  );
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'GameCatalog Push Server funcionando'
  });
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
});

app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    return res.status(400).json({
      message: 'La suscripción no es válida'
    });
  }

  const subscriptions = getSubscriptions();

  const exists = subscriptions.some(
    item => item.endpoint === subscription.endpoint
  );

  if (!exists) {
    subscriptions.push(subscription);
    saveSubscriptions(subscriptions);
  }

  res.status(201).json({
    message: 'Suscripción registrada correctamente',
    total: subscriptions.length
  });
});

app.post('/api/push', async (req, res) => {
  const { title, body, url = '/' } = req.body;

  if (!title || !body) {
    return res.status(400).json({
      message: 'El título y el contenido son obligatorios'
    });
  }

  const subscriptions = getSubscriptions();

  if (subscriptions.length === 0) {
    return res.json({
      message: 'No existen suscripciones registradas',
      sent: 0
    });
  }

  const payload = JSON.stringify({
    notification: {
      title,
      body,
      data: {
        onActionClick: {
          default: {
            operation: 'openWindow',
            url
          }
        }
      }
    }
  });

  const results = await Promise.allSettled(
    subscriptions.map(subscription =>
      webPush.sendNotification(subscription, payload)
    )
  );

  const validSubscriptions = subscriptions.filter((subscription, index) => {
    const result = results[index];

    if (result.status === 'fulfilled') {
      return true;
    }

    const statusCode = result.reason?.statusCode;

    return statusCode !== 404 && statusCode !== 410;
  });

  saveSubscriptions(validSubscriptions);

  const sent = results.filter(
    result => result.status === 'fulfilled'
  ).length;

  res.json({
    message: 'Proceso de envío finalizado',
    sent,
    total: subscriptions.length
  });
});

app.listen(PORT, () => {
  console.log(`GameCatalog Push Server escuchando en http://localhost:${PORT}`);
});
