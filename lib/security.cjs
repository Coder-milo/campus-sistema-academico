'use strict';

const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const validPassword = value => typeof value === 'string' && value.length >= 14 && Buffer.byteLength(value) <= 128;

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 32, parameters);
  return `${salt}:${key.toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [salt, expected] = stored.split(':');
  const [, actual] = (await passwordHash(password, salt)).split(':');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

module.exports = { token, digest, validPassword, passwordHash, passwordMatches };
