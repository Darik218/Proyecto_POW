// Retain an operation UUID while the server response is uncertain, including after a version reload.
export function requestIntent() {
  const ids = new Map<string, string>()
  function key(value: object) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .filter(([field]) => field !== 'expectedVersion' && field !== 'id')
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
  }
  return {
    id(value: object) {
      const signature = key(value)
      let id = ids.get(signature)
      if (!id) {
        id = crypto.randomUUID()
        ids.set(signature, id)
      }
      return id
    },
    confirmed(value: object) {
      ids.delete(key(value))
    },
  }
}
