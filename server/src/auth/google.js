import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

const client = new OAuth2Client();

// Verifies the ID token: Google's signature, issuer, expiry and that it was
// issued for OUR app (audience). Throws if anything is wrong.
// Returns the token's claims (sub, email, email_verified, name, picture, ...).
export async function verifyGoogleCredential(credential) {
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  return ticket.getPayload();
}
