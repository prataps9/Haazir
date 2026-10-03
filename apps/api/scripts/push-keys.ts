/**
 * Generates a VAPID key pair for push notifications. Put both in .env (and the
 * public one is served to browsers by /api/v1/push/public-key). Generate once
 * per environment: changing them invalidates every existing subscription.
 *
 *   pnpm push:keys
 */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`)
