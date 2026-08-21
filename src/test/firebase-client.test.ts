import { describe, expect, it } from 'vitest'

import {
  REQUIRED_FIREBASE_ENV_NAMES,
  validateFirebaseEnvironment,
} from '../firebase/client'

const validEnvironment = {
  VITE_FIREBASE_API_KEY: 'public-web-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'tradingagents.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'tradingagents-project',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
  VITE_FIREBASE_DATABASE_ID: '(default)',
}

describe('validateFirebaseEnvironment', () => {
  it('lists only exact missing public variable names and never their values', () => {
    const result = validateFirebaseEnvironment({
      VITE_FIREBASE_API_KEY: 'do-not-print-this-value',
      VITE_FIREBASE_AUTH_DOMAIN: ' ',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toEqual([
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
      'VITE_FIREBASE_DATABASE_ID',
    ])
    expect(result.message).not.toContain('do-not-print-this-value')
    expect(REQUIRED_FIREBASE_ENV_NAMES).toEqual([
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
      'VITE_FIREBASE_DATABASE_ID',
    ])
  })

  it('fails closed for every named Firestore database', () => {
    const result = validateFirebaseEnvironment({
      ...validEnvironment,
      VITE_FIREBASE_DATABASE_ID: 'production-history',
    })

    expect(result).toEqual({
      ok: false,
      config: null,
      missing: [],
      invalid: ['VITE_FIREBASE_DATABASE_ID'],
      message: 'This workstation requires the default Cloud Firestore database.',
    })
  })

  it('builds Firebase options from required and non-empty optional public values', () => {
    const result = validateFirebaseEnvironment({
      ...validEnvironment,
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender-123',
      VITE_FIREBASE_STORAGE_BUCKET: 'tradingagents.appspot.com',
      VITE_FIREBASE_MEASUREMENT_ID: '   ',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.databaseId).toBe('(default)')
    expect(result.config.options).toEqual({
      apiKey: 'public-web-api-key',
      authDomain: 'tradingagents.firebaseapp.com',
      projectId: 'tradingagents-project',
      appId: '1:123:web:abc',
      messagingSenderId: 'sender-123',
      storageBucket: 'tradingagents.appspot.com',
    })
    expect(result.config.options).not.toHaveProperty('measurementId')
  })
})
