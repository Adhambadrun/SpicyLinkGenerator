import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FROM_EMAIL,
  describeSendFailure,
  sendDeliveryTestEmail,
  isTestSender,
  mailConfig,
  missingMailConfig,
  senderSetupHint,
  sendLoginCodeEmail,
} from '../lib/mailer.js';

test('mailConfig trims environment values and requires a key', () => {
  const customConfig = mailConfig({ RESEND_API_KEY: '  re_test  ', FROM_EMAIL: '  test@example.com  ' });
  assert.equal(customConfig.apiKey, 're_test');
  assert.equal(customConfig.fromEmail, 'test@example.com');

  const defaultConfig = mailConfig({});
  assert.equal(defaultConfig.apiKey, '');
  assert.equal(defaultConfig.fromEmail, DEFAULT_FROM_EMAIL);

  const disabledConfig = mailConfig({ RESEND_API_KEY: 'disabled', FROM_EMAIL: 'disabled' });
  assert.equal(disabledConfig.apiKey, '');
  assert.equal(disabledConfig.fromEmail, '');
});

test('the sender defaults to onboarding@resend.dev and is never derived from the sign-in domains', () => {
  assert.equal(DEFAULT_FROM_EMAIL, 'Spicy Link Generator <onboarding@resend.dev>');
  // ALLOWED_DOMAINS only decides who may sign in — it must not become the sender.
  assert.equal(mailConfig({ ALLOWED_DOMAINS: 'one.com, two.org' }).fromEmail, DEFAULT_FROM_EMAIL);
  assert.equal(mailConfig({ ALLOWED_DOMAIN: 'legacy.com' }).fromEmail, DEFAULT_FROM_EMAIL);
  // An explicit FROM_EMAIL always wins.
  assert.equal(mailConfig({ ALLOWED_DOMAINS: 'one.com', FROM_EMAIL: 'login@two.org' }).fromEmail, 'login@two.org');
});

test('the sandbox sender is detected and explained in one short, actionable sentence', () => {
  assert.equal(isTestSender('Spicy Link Generator <onboarding@resend.dev>'), true);
  assert.equal(isTestSender('onboarding@resend.dev'), true);
  assert.equal(isTestSender('Spicy Link Generator <login@bcflights.com>'), false);
  assert.equal(isTestSender(''), false);

  const hint = senderSetupHint('Spicy Link Generator <onboarding@resend.dev>');
  assert.match(hint, /resend\.dev/);
  assert.match(hint, /resend\.com\/domains/);
  assert.match(hint, /FROM_EMAIL/);
  assert.match(hint, /APPROVER_EMAIL/);
  assert.match(hint, /adhambadraan@gmail\.com/, 'the hint names the inbox the codes actually go to');
  assert.ok(hint.length < 400, 'the login page shows this sentence — it must stay short');
  assert.equal(senderSetupHint('Spicy Link Generator <login@bcflights.com>'), '');
  // A custom approver inbox is what the hint points the owner at.
  assert.match(senderSetupHint('Spicy Link Generator <onboarding@resend.dev>', 'boss@example.com'), /boss@example\.com/);

  // The provider's paragraph-long rejection collapses into that same short sentence,
  // flagged as a setup problem so the login page can say so instead of blaming the user.
  const sandboxFailure = describeSendFailure(
    'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
    'Spicy Link Generator <onboarding@resend.dev>'
  );
  assert.equal(sandboxFailure.setup, true);
  assert.match(sandboxFailure.error, /could only|test address|resend\.com\/domains/);
  assert.match(sandboxFailure.error, /adhambadraan@gmail\.com/);
  assert.ok(sandboxFailure.error.length < 400, 'the login page must not be handed a wall of provider text');

  const unverifiedDomain = describeSendFailure('The bcflights.com domain is not verified.', 'login@bcflights.com');
  assert.equal(unverifiedDomain.setup, true);
  assert.match(unverifiedDomain.error, /not a verified/);

  const badKey = describeSendFailure('Invalid API key', 'login@bcflights.com');
  assert.equal(badKey.setup, true);
  assert.match(badKey.error, /RESEND_API_KEY/);

  const rateLimited = describeSendFailure('Too many requests — rate limit exceeded', 'login@bcflights.com');
  assert.equal(rateLimited.setup, false);
  assert.match(rateLimited.error, /wait a minute/i);

  const other = describeSendFailure('socket hang up', 'login@bcflights.com');
  assert.equal(other.setup, false);
  assert.match(other.error, /socket hang up/);
});

test('a sandbox-sender rejection from the provider is reported as a setup problem', async () => {
  const out = await sendLoginCodeEmail({
    to: 'person@bcflights.com',
    requester: 'person@bcflights.com',
    name: 'Person',
    code: '123456',
    apiKey: 're_test',
    fromEmail: 'Spicy Link Generator <onboarding@resend.dev>',
    resendClient: {
      emails: {
        send: async () => ({
          data: null,
          error: {
            statusCode: 403,
            message:
              'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
          },
        }),
      },
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.setup, true);
  assert.ok(out.error.length < 400);
});

test('missing mail credentials are reported without importing or calling Resend', async () => {
  const disabledConfig = mailConfig({ RESEND_API_KEY: 'disabled', FROM_EMAIL: DEFAULT_FROM_EMAIL });
  assert.match(missingMailConfig(disabledConfig), /RESEND_API_KEY/);
  assert.match(missingMailConfig({ apiKey: '', fromEmail: DEFAULT_FROM_EMAIL }), /RESEND_API_KEY/);
  assert.match(missingMailConfig({ apiKey: 're_test', fromEmail: '' }), /FROM_EMAIL/);

  const out = await sendLoginCodeEmail({
    to: 'person@bcflights.com',
    requester: 'person@bcflights.com',
    name: 'Person',
    code: '123456',
    apiKey: '',
    fromEmail: DEFAULT_FROM_EMAIL,
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /RESEND_API_KEY/);
});

test('an email with no approver inbox is rejected before trying to send', async () => {
  const out = await sendLoginCodeEmail({
    to: '',
    requester: 'person@bcflights.com',
    name: 'Person',
    code: '123456',
    apiKey: 're_test',
    fromEmail: DEFAULT_FROM_EMAIL,
  });
  assert.equal(out.ok, false);
  assert.equal(out.setup, true, 'this is a deployment problem, not a visitor mistake');
  assert.match(out.error, /APPROVER_EMAIL/);
});

test('a successful provider response is accepted and the sign-in email is escaped', async () => {
  let payload;
  const out = await sendLoginCodeEmail({
    to: 'first@example.com, second@example.com',
    requester: 'person@bcflights.com',
    name: '<Person>',
    code: '123456',
    apiKey: 're_test',
    fromEmail: DEFAULT_FROM_EMAIL,
    resendClient: {
      emails: {
        send: async (value) => {
          payload = value;
          return { data: { id: 'email-test-id' }, error: null };
        },
      },
    },
  });

  assert.deepEqual(out, { ok: true, id: 'email-test-id' });
  assert.deepEqual(payload.to, ['first@example.com', 'second@example.com']);
  assert.match(payload.html, /&lt;Person&gt;/);
  assert.match(payload.text, /6-digit code: 123456/);
  // The approver gets the request, the person who asked for it, and the code.
  assert.match(payload.subject, /Login request — <Person> \(person@bcflights\.com\) — code 123456/);
  assert.match(payload.html, /is trying to sign in/);
  assert.match(payload.html, /Send this code to <strong>&lt;Person&gt;<\/strong>/);
  assert.match(payload.text, /person@bcflights\.com/);
  assert.ok(!/emailed to person@bcflights\.com/.test(payload.text), 'the code is never addressed to the requester');
});

test('the delivery test proves the sender and the approver inbox can reach each other', async () => {
  let payload;
  const out = await sendDeliveryTestEmail({
    to: 'adhambadraan@gmail.com',
    apiKey: 're_test',
    fromEmail: DEFAULT_FROM_EMAIL,
    resendClient: {
      emails: {
        send: async (value) => {
          payload = value;
          return { data: { id: 'test-id' }, error: null };
        },
      },
    },
  });
  assert.deepEqual(out, { ok: true, id: 'test-id' });
  assert.deepEqual(payload.to, ['adhambadraan@gmail.com']);
  assert.match(payload.subject, /delivery test/i);
  assert.ok(!/6-digit code: \d{6}/.test(payload.text), 'the test email must never contain a real sign-in code');

  const noRecipient = await sendDeliveryTestEmail({ to: '', apiKey: 're_test', fromEmail: DEFAULT_FROM_EMAIL });
  assert.equal(noRecipient.ok, false);
  assert.match(noRecipient.error, /APPROVER_EMAIL/);
});
