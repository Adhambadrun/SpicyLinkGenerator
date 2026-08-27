import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FROM_EMAIL,
  DEFAULT_RESEND_API_KEY,
  mailConfig,
  missingMailConfig,
  sendApprovalEmail,
} from '../lib/mailer.js';

test('mailConfig trims environment values and uses the default key and sender', () => {
  const customConfig = mailConfig({ RESEND_API_KEY: '  re_test  ', FROM_EMAIL: '  test@example.com  ' });
  assert.equal(customConfig.apiKey, 're_test');
  assert.equal(customConfig.fromEmail, 'test@example.com');

  const defaultConfig = mailConfig({});
  assert.equal(defaultConfig.apiKey, DEFAULT_RESEND_API_KEY);
  assert.equal(defaultConfig.fromEmail, DEFAULT_FROM_EMAIL);

  const disabledConfig = mailConfig({ RESEND_API_KEY: 'disabled', FROM_EMAIL: 'disabled' });
  assert.equal(disabledConfig.apiKey, '');
  assert.equal(disabledConfig.fromEmail, '');
});

test('missing mail credentials are reported without importing or calling Resend', async () => {
  const disabledConfig = mailConfig({ RESEND_API_KEY: 'disabled', FROM_EMAIL: DEFAULT_FROM_EMAIL });
  assert.match(missingMailConfig(disabledConfig), /RESEND_API_KEY/);
  assert.match(missingMailConfig({ apiKey: '', fromEmail: DEFAULT_FROM_EMAIL }), /RESEND_API_KEY/);
  assert.match(missingMailConfig({ apiKey: DEFAULT_RESEND_API_KEY, fromEmail: '' }), /FROM_EMAIL/);

  const out = await sendApprovalEmail({
    to: 'approver@example.com',
    requester: 'person@bcflights.com',
    name: 'Person',
    code: '123456',
    apiKey: '',
    fromEmail: DEFAULT_FROM_EMAIL,
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /RESEND_API_KEY/);
});

test('an empty approver list is rejected before trying to send', async () => {
  const out = await sendApprovalEmail({
    to: '',
    requester: 'person@bcflights.com',
    name: 'Person',
    code: '123456',
    apiKey: 're_test',
    fromEmail: DEFAULT_FROM_EMAIL,
  });
  assert.equal(out.ok, false);
  assert.match(out.error, /APPROVER_EMAIL/);
});

test('a successful provider response is accepted and the approval email is escaped', async () => {
  let payload;
  const out = await sendApprovalEmail({
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
});
