import { describe, expect, it } from 'vitest'

import { friendlyFirebaseError } from '../auth/firebase'

describe('friendlyFirebaseError', () => {
  it.each([
    ['auth/invalid-credential', 'Email or password is incorrect.'],
    ['auth/user-disabled', 'This account has been disabled.'],
    ['auth/too-many-requests', 'Too many sign-in attempts.'],
    ['auth/popup-blocked', 'The sign-in popup was blocked.'],
    ['auth/popup-closed-by-user', 'Google sign-in was cancelled.'],
    ['auth/network-request-failed', 'authentication service could not be reached'],
    ['auth/unauthorized-domain', 'domain is not authorized'],
    ['auth/configuration-not-found', 'not configured correctly'],
  ])('maps %s to stable public copy', (code, copy) => {
    expect(friendlyFirebaseError({ code, serverResponse: 'do-not-display' })).toContain(copy)
  })

  it('never exposes unknown SDK error details', () => {
    expect(
      friendlyFirebaseError({
        code: 'auth/something-new',
        message: 'secret internal response and stack details',
      }),
    ).toBe('Authentication could not be completed. Please try again.')
  })
})
