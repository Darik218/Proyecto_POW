// An in-process capability; never accepted from HTTP or serialized credentials.
const capability = Object.freeze({
  kind: 'PULSO_INTERNAL_PROGRESSION_WORKER_V1',
});
export type InternalProgressionCapability = typeof capability;
export function internalProgressionCapability(): InternalProgressionCapability {
  return capability;
}
export function assertInternalProgressionCapability(
  value: unknown,
): asserts value is InternalProgressionCapability {
  if (value !== capability)
    throw Error('Internal progression capability required');
}
