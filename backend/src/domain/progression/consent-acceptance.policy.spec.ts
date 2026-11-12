import { randomUUID } from 'node:crypto';
import {
  acceptanceCommand,
  acceptanceContext,
  ACCEPTANCE_PRESENTATION,
} from './consent-acceptance.policy';
describe('non-operational recurrent acceptance command', () => {
  const input = () => ({
    consentId: randomUUID(),
    intentId: randomUUID(),
    challengeId: randomUUID(),
    expectedVersion: 1,
    expectedState: 'PENDING_CONFIRMATION',
    contractKey: 'a'.repeat(64),
    conditionsKey: 'b'.repeat(64),
    contextKey: 'c'.repeat(64),
    termsVersion: 'terms-v1',
    presentationVersion: ACCEPTANCE_PRESENTATION,
    conditionsPresented: true,
    acknowledgments: {
      policy: true,
      limits: true,
      destinations: true,
      validity: true,
      revocation: true,
    },
  });
  it('retains explicit conditions and has stable request identity', () => {
    const v = input();
    const a = acceptanceCommand(v);
    expect(a.action).toBe('ACCEPT');
    expect(a.acceptance?.acknowledgments).toEqual(v.acknowledgments);
    expect(acceptanceCommand({ ...v }).requestKey).toBe(a.requestKey);
    expect(
      acceptanceCommand({ ...v, termsVersion: 'terms-v2' }).requestKey,
    ).not.toBe(a.requestKey);
  });
  it.each(['policy', 'limits', 'destinations', 'validity', 'revocation'])(
    'rejects missing %s acknowledgment',
    (key) => {
      const v = input();
      expect(() =>
        acceptanceCommand({
          ...v,
          acknowledgments: { ...v.acknowledgments, [key]: false },
        }),
      ).toThrow('INVALID_CONSENT_COMMAND');
    },
  );
  it('rejects undisplayed or arbitrary affirmative data', () => {
    const v = input();
    expect(() =>
      acceptanceCommand({ ...v, conditionsPresented: false }),
    ).toThrow();
    expect(() =>
      acceptanceCommand({ ...v, state: 'ACCEPTED_INACTIVE' }),
    ).toThrow();
    expect(() =>
      acceptanceCommand({ ...v, expectedState: 'REVOKED' }),
    ).toThrow();
    expect(() =>
      acceptanceCommand({
        ...v,
        acknowledgments: { ...v.acknowledgments, automaticExecution: true },
      }),
    ).toThrow();
  });
  it('binds opaque context to the real session, even for the same account', () => {
    const u = randomUUID(),
      s = randomUUID();
    expect(acceptanceContext(u, s)).toBe(acceptanceContext(u, s));
    expect(acceptanceContext(u, s)).not.toBe(
      acceptanceContext(u, randomUUID()),
    );
    expect(acceptanceContext(u, s)).not.toContain(s);
  });
});
