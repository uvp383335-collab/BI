import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, setAccessToken } from './tokenStore'

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1'

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true // sends the httpOnly refresh-token cookie
})

httpClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers ?? {}
    // Do not overwrite an Authorization header if one was already provided (e.g. a pending token).
    const hasAuthHeader = Boolean(config.headers && (config.headers as any).Authorization)
    if (!hasAuthHeader) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    )
    const newToken = res.data?.data?.accessToken ?? null
    setAccessToken(newToken)
    return newToken
  } catch {
    setAccessToken(null)
    return null
  }
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status
    const url = originalRequest?.url ?? ''

    // Avoid retry loops on the refresh/login endpoints themselves.
    if (status === 401 && originalRequest && !originalRequest._retry && !url.includes('/auth/refresh')) {
      originalRequest._retry = true
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null
        })
      }
      const newToken = await refreshPromise
      if (newToken) {
        originalRequest.headers = originalRequest.headers ?? {}
        // Overwrite the Authorization header for the retried request so it uses the freshly issued access token.
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return httpClient(originalRequest)
      }
    }
    return Promise.reject(error)
  }
)
