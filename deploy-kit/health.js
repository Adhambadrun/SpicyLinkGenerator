// GET /api/health
// Quick check that the server functions are deployed and reachable.
// Open https://YOUR-SITE.vercel.app/api/health in a browser — it must return {"ok":true}.
// If it returns a 404 page instead, the API is not running (wrong host / static-only deploy).
//
// GET /api/health?send=1 additionally sends a real delivery-test email (no code in it) to the
// approver inbox and reports what Resend said. That single URL is the fastest way to prove
// sign-in codes can actually arrive — mailReadyToSend only says a send can be attempted.
import { mailConfig, missingMailConfig, isTestSender, senderSetupHint, sendDeliveryTestEmail } from '../lib/mailer.js';
import { approverEmail } from '../lib/core.js';

// Best-effort guard so the public URL cannot be used to spam the approver inbox. Serverless
// instances each keep their own copy; one test per half-minute is plenty for a human.
const PROBE_COOLDOWN_MS = 30 * 1000;
let lastProbeAt = 0;

/**
 * Run the delivery test (used by ?send=1 and by the tests, which can inject a stubbed
 * Resend client). Returns { status, delivery } so the handler only has to serialise it.
 */
export async function probeDelivery({ resendClient } = {}) {
  const since = Date.now() - lastProbeAt;
  if (since < PROBE_COOLDOWN_MS) {
    return {
      status: 429,
      delivery: {
        ok: false,
        error: `A delivery test was already sent ${Math.round(since / 1000)}s ago — wait ${Math.ceil((PROBE_COOLDOWN_MS - since) / 1000)}s and reload.`,
      },
    };
  }

  const { apiKey, fromEmail } = mailConfig();
  const approver = approverEmail();
  const configurationError = missingMailConfig({ apiKey, fromEmail });
  if (configurationError || !approver) {
    return {
      status: 500,
      delivery: {
        ok: false,
        error:
          configurationError ||
          'APPROVER_EMAIL is empty, so sign-in codes have nowhere to go. Point it at the inbox that should approve sign-ins, then redeploy.',
      },
    };
  }

  lastProbeAt = Date.now();
  const out = await sendDeliveryTestEmail({ to: approver, apiKey, fromEmail, resendClient });
  return out.ok
    ? {
        status: 200,
        delivery: { ok: true, id: out.id, message: `Resend accepted a test email for ${approver}. Check that inbox.` },
      }
    : { status: 502, delivery: { ok: false, error: out.error, setupError: Boolean(out.setup) } };
}

function probeRequested(req) {
  const query = req && req.query;
  if (query) {
    const value = query.send ?? query.delivery;
    if (value !== undefined) return String(Array.isArray(value) ? value[0] : value) === '1';
  }
  return /[?&](?:send|delivery)=1(?:&|$)/.test(String((req && req.url) || ''));
}

function statusReport() {
  const { apiKey, fromEmail } = mailConfig();
  const approver = approverEmail();
  const testSender = isTestSender(fromEmail);

  const report = {
    ok: true,
    app: 'Spicy Link Generator',
    api: 'v2',
    // Where every sign-in code is delivered. The approver passes it on to whoever asked.
    otpRecipient: approver || 'not configured (set APPROVER_EMAIL)',
    mailConfigured: Boolean(apiKey),
    mailFrom: fromEmail,
    // Resend's shared onboarding@resend.dev sender only delivers to the address its account
    // is registered to — with the approver default that is harmless, hence `sandboxSender`
    // is reported rather than treated as a failure.
    sandboxSender: testSender,
    mailReadyToSend: Boolean(apiKey) && Boolean(fromEmail) && Boolean(approver),
    deliveryTestUrl: '/api/health?send=1',
  };

  if (!approver) {
    report.setupHint =
      'APPROVER_EMAIL is empty, so sign-in codes have nowhere to go. Point it at the inbox that should approve sign-ins, then redeploy.';
  } else if (testSender) {
    report.setupHint = senderSetupHint(fromEmail, approver);
  }
  return report;
}

export default async function handler(req, res) {
  const body = statusReport();

  if (!probeRequested(req)) return res.status(200).json(body);

  const { status, delivery } = await probeDelivery();
  return res.status(status).json({ ...body, delivery });
}
