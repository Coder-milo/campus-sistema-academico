'use strict';

const { Pool } = require('pg');
const { accounts, seed } = require('./data.cjs');
const { passwordHash, validPassword } = require('./security.cjs');

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function initialize(connectionString, bootstrap) {
  if (!connectionString) throw Error('Configura DATABASE_URL.');
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 8000 });
  try {
    await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(416726)');
      await db.query(`
        CREATE TABLE IF NOT EXISTS campus_data(id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS campus_accounts(username text PRIMARY KEY, password_hash text NOT NULL);
        CREATE TABLE IF NOT EXISTS campus_sessions(hash text PRIMARY KEY, username text NOT NULL REFERENCES campus_accounts,
          csrf text NOT NULL, created timestamptz NOT NULL DEFAULT now(), touched timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS campus_limits(key text PRIMARY KEY, attempts integer NOT NULL, expires timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS campus_audit(sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event jsonb NOT NULL);
      `);
      await db.query('INSERT INTO campus_data VALUES (1, $1) ON CONFLICT DO NOTHING', [seed()]);
      const users = (await db.query('SELECT username FROM campus_accounts')).rows;
      const missing = accounts.filter(a => !users.some(r => r.username === a.user));
      if (!missing.length) return;
      const passwords = JSON.parse(bootstrap || '{}');
      for (const account of missing) {
        const password = passwords[account.user];
        if (!validPassword(password)) throw Error('Configura CAMPUS_BOOTSTRAP con las cuatro contraseñas de al menos 14 caracteres.');
        await db.query('INSERT INTO campus_accounts VALUES ($1,$2)', [account.user, await passwordHash(password)]);
      }
    });
    return pool;
  } catch (error) { await pool.end(); throw error; }
}

async function audit(db, event) {
  await db.query('INSERT INTO campus_audit(event) VALUES($1)', [event]);
}

async function loginAllowed(pool, keys) {
  return transaction(pool, async db => {
    await db.query('DELETE FROM campus_limits WHERE expires <= now()');
    let allowed = true;
    for (const [key, max] of keys) {
      const { rows } = await db.query(`INSERT INTO campus_limits VALUES($1,1,now()+interval '10 minutes')
        ON CONFLICT(key) DO UPDATE SET attempts=LEAST(campus_limits.attempts+1,100)
        RETURNING attempts`, [key]);
      if (rows[0].attempts > max) allowed = false;
    }
    return allowed;
  });
}

module.exports = { initialize, transaction, loginAllowed, audit };
