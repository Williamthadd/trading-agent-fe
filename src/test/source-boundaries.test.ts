import { describe, expect, it } from 'vitest'
import firestoreRules from '../../firestore.rules?raw'
import { TRADING_APP_ALLOWED_EMAIL } from '../auth/accessPolicy'

const productionSources = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function joinedProductionSource(): string {
  return Object.entries(productionSources)
    .filter(([path]) => !path.includes('/test/'))
    .map(([, source]) => source)
    .join('\n')
}

describe('production source boundaries', () => {
  it('contains no Firestore write capability', () => {
    const source = joinedProductionSource()
    for (const primitive of [
      'addDoc',
      'setDoc',
      'updateDoc',
      'deleteDoc',
      'writeBatch',
      'runTransaction',
      'serverTimestamp',
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${primitive}\\b`))
    }
  })

  it('contains no removed FastAPI auth, history, or run-detail route', () => {
    const source = joinedProductionSource()
    expect(source).not.toContain('/api/auth/config')
    expect(source).not.toContain('/api/auth/session')
    expect(source).not.toContain('/api/history')
    expect(source).not.toMatch(/\/api\/runs\/\$\{/)
  })

  it('keeps the frontend owner email coupled to the deployed Firestore read rule', () => {
    expect(firestoreRules).toContain(
      `request.auth.token.email == '${TRADING_APP_ALLOWED_EMAIL}'`,
    )
    expect(firestoreRules).toContain('request.auth.token.email_verified == true')
    expect(firestoreRules).not.toContain('tradingagents_members/$(request.auth.uid)')
  })
})
