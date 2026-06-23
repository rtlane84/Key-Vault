import Stripe from "stripe";

const clients = new Map<string, Stripe>();

export function getStripe(secretKey?: string): Stripe {
  const key = secretKey || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe secret key not provided or set in ENV");

  let client = clients.get(key);
  if (!client) {
    client = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
    clients.set(key, client);
  }
  return client;
}
