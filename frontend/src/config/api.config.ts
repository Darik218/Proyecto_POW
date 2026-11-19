const configuredBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim()

export const apiConfig = {
  baseURL: configuredBaseUrl || '/api/v1',
  timeout: 15_000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
}
