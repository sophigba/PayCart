const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// ── SECRETS MANAGER ───────────────────────
// Fetch DB credentials once and cache them
let cachedCredentials = null;

async function getCredentials() {
  if (cachedCredentials) return cachedCredentials;

  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const secret = await client.send(
    new GetSecretValueCommand({ SecretId: 'db-credentials' })
  );

  cachedCredentials = JSON.parse(secret.SecretString);
  return cachedCredentials;
}

// ── DB CONNECTION ─────────────────────────
async function getConnection() {
  const creds = await getCredentials();

  return mysql.createConnection({
    host:     creds.host,
    user:     creds.username,
    password: creds.password,
    database: 'paycart'
  });
}

// ── RESPONSE HELPER ───────────────────────
function respond(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

// ── MAIN HANDLER ──────────────────────────
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.requestContext?.http?.path || event.path;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return respond(200, {});
  }

  let conn;

  try {
    conn = await getConnection();

    // ── GET /products ──────────────────────
    if (method === 'GET' && path === '/products') {
      const [rows] = await conn.execute('SELECT * FROM products');
      return respond(200, rows);
    }

    // ── GET /products/{id} ─────────────────
    if (method === 'GET' && path.startsWith('/products/')) {
      const id = path.split('/')[2];
      const [rows] = await conn.execute(
        'SELECT * FROM products WHERE id = ?', [id]
      );
      if (!rows.length) return respond(404, { error: 'Product not found' });
      return respond(200, rows[0]);
    }

    // ── GET /orders ────────────────────────
    if (method === 'GET' && path === '/orders') {
      const [rows] = await conn.execute(
        'SELECT * FROM orders ORDER BY created_at DESC'
      );
      return respond(200, rows);
    }

    // ── GET /orders/{userId} ───────────────
    if (method === 'GET' && path.startsWith('/orders/')) {
      const userId = path.split('/')[2];
      const [rows] = await conn.execute(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]
      );
      return respond(200, rows);
    }

    // ── POST /orders ───────────────────────
    if (method === 'POST' && path === '/orders') {
      const body = JSON.parse(event.body || '{}');
      const { user_id, total_amount, items } = body;

      if (!total_amount || !items?.length) {
        return respond(400, { error: 'Missing required fields' });
      }

      // Insert order
      const [orderResult] = await conn.execute(
        'INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, ?)',
        [user_id || null, total_amount, 'pending']
      );

      const orderId = orderResult.insertId;

      // Insert order items
      for (const item of items) {
        await conn.execute(
          'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [orderId, item.product_id, item.quantity, item.unit_price]
        );

        // Reduce stock
        await conn.execute(
          'UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?',
          [item.quantity, item.product_id]
        );
      }

      return respond(201, { success: true, order_id: orderId });
    }

    // ── POST /admin/products ───────────────
    if (method === 'POST' && path === '/admin/products') {
      const body = JSON.parse(event.body || '{}');
      const { name, description, price, stock_qty, image_url } = body;

      if (!name || !price) {
        return respond(400, { error: 'Name and price are required' });
      }

      const [result] = await conn.execute(
        'INSERT INTO products (name, description, price, stock_qty, image_url) VALUES (?, ?, ?, ?, ?)',
        [name, description || '', price, stock_qty || 0, image_url || '']
      );

      return respond(201, { success: true, product_id: result.insertId });
    }

    // ── DELETE /admin/products/{id} ────────
    if (method === 'DELETE' && path.startsWith('/admin/products/')) {
      const id = path.split('/')[3];
      await conn.execute('DELETE FROM products WHERE id = ?', [id]);
      return respond(200, { success: true });
    }

    // ── 404 ────────────────────────────────
    return respond(404, { error: `Route not found: ${method} ${path}` });

  } catch (err) {
    console.error('Lambda error:', err);
    return respond(500, { error: err.message });

  } finally {
    if (conn) await conn.end();
  }
};