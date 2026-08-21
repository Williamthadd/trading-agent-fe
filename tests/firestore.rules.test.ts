import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { readFile } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TRADING_APP_ALLOWED_EMAIL } from '../src/auth/accessPolicy'

const PROJECT_ID =
  process.env.FIREBASE_RULES_TEST_PROJECT_ID ?? 'demo-tradingagents-rules'
const OWNER_UID = 'owner-user-01'
const SECOND_UID = 'second-user-02'
const RUN_ID = '0123456789abcdef0123456789abcdef'
const SECOND_RUN_ID = 'abcdef0123456789abcdef0123456789'
const EVENT_ID = 'event-0001'
const DATE_KEY = '2026-08-21'

let testEnvironment: RulesTestEnvironment

const ALLOWED_AUTH_CLAIMS = {
  email: TRADING_APP_ALLOWED_EMAIL,
  email_verified: true,
}

function authenticatedDb(
  uid: string,
  claims: Record<string, unknown> = ALLOWED_AUTH_CLAIMS,
) {
  return testEnvironment.authenticatedContext(uid, claims).firestore()
}

function emulatorAddress(): { host: string; port: number } {
  const configured = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
  const separator = configured.lastIndexOf(':')
  const host = configured.slice(0, separator)
  const port = Number(configured.slice(separator + 1))
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid FIRESTORE_EMULATOR_HOST: ${configured}`)
  }
  return { host, port }
}

async function seed(options: {
  includeRuns?: boolean
  includeEvent?: boolean
} = {}): Promise<void> {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    if (options.includeRuns) {
      await setDoc(doc(db, 'trading_runs', RUN_ID), {
        run_id: RUN_ID,
        ticker: 'NVDA',
        date_key: DATE_KEY,
      })
      await setDoc(doc(db, 'trading_runs', SECOND_RUN_ID), {
        run_id: SECOND_RUN_ID,
        ticker: 'AMD',
        date_key: '2026-08-20',
      })
    }
    if (options.includeEvent) {
      await setDoc(
        doc(db, 'trading_runs', RUN_ID, 'events', EVENT_ID),
        { event_id: EVENT_ID, sequence: 1, message: 'rules test event' },
      )
    }
  })
}

beforeAll(async () => {
  const rules = await readFile(
    new URL('../firestore.rules', import.meta.url),
    'utf8',
  )
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...emulatorAddress(), rules },
  })
})

afterEach(async () => {
  await testEnvironment.clearFirestore()
})

afterAll(async () => {
  await testEnvironment.cleanup()
})

describe('read-only TradingAgents Firestore rules', () => {
  it('denies unauthenticated reads of runs and nested events', async () => {
    await seed({ includeRuns: true, includeEvent: true })
    const db = testEnvironment.unauthenticatedContext().firestore()

    await assertFails(getDocFromServer(doc(db, 'trading_runs', RUN_ID)))
    await assertFails(getDocsFromServer(collection(db, 'trading_runs')))
    await assertFails(
      getDocFromServer(doc(db, 'trading_runs', RUN_ID, 'events', EVENT_ID)),
    )
    await assertFails(
      getDocsFromServer(collection(db, 'trading_runs', RUN_ID, 'events')),
    )
  })

  it('allows the exact verified owner email without a membership document', async () => {
    await seed({ includeRuns: true, includeEvent: true })
    const db = authenticatedDb(SECOND_UID)

    await assertSucceeds(getDocFromServer(doc(db, 'trading_runs', RUN_ID)))
    await assertSucceeds(getDocsFromServer(collection(db, 'trading_runs')))
    await assertSucceeds(
      getDocFromServer(doc(db, 'trading_runs', RUN_ID, 'events', EVENT_ID)),
    )
    await assertSucceeds(
      getDocsFromServer(collection(db, 'trading_runs', RUN_ID, 'events')),
    )
  })

  it('authorizes the owner identity claims rather than a particular Firebase UID', async () => {
    await seed({ includeRuns: true, includeEvent: true })
    const db = authenticatedDb(OWNER_UID)

    await assertSucceeds(getDocFromServer(doc(db, 'trading_runs', RUN_ID)))
    await assertSucceeds(getDocsFromServer(collection(db, 'trading_runs')))
    const events = await assertSucceeds(
      getDocsFromServer(collection(db, 'trading_runs', RUN_ID, 'events')),
    )
    expect(events.docs.map((snapshot) => snapshot.id)).toEqual([EVENT_ID])
  })

  it.each([
    ['another email', { email: 'another@example.com', email_verified: true }],
    ['an unverified owner email', { email: TRADING_APP_ALLOWED_EMAIL, email_verified: false }],
    ['no email claim', { email_verified: true }],
  ])('denies an authenticated user using %s', async (_label, claims) => {
    await seed({ includeRuns: true, includeEvent: true })
    const db = authenticatedDb(OWNER_UID, claims)

    await assertFails(getDocFromServer(doc(db, 'trading_runs', RUN_ID)))
    await assertFails(getDocsFromServer(collection(db, 'trading_runs')))
    await assertFails(
      getDocsFromServer(collection(db, 'trading_runs', RUN_ID, 'events')),
    )
  })

  it('allows the exact date_key equality query without server ordering', async () => {
    await seed({ includeRuns: true })
    const db = authenticatedDb(OWNER_UID)

    const result = await assertSucceeds(
      getDocsFromServer(
        query(
          collection(db, 'trading_runs'),
          where('date_key', '==', DATE_KEY),
        ),
      ),
    )
    expect(result.docs.map((snapshot) => snapshot.id)).toEqual([RUN_ID])
  })

  it('denies owner create, update, and delete operations on runs', async () => {
    await seed({ includeRuns: true })
    const db = authenticatedDb(OWNER_UID)

    await assertFails(
      setDoc(doc(db, 'trading_runs', '11111111111111111111111111111111'), {
        ticker: 'AAPL',
      }),
    )
    await assertFails(
      updateDoc(doc(db, 'trading_runs', RUN_ID), { status: 'tampered' }),
    )
    await assertFails(deleteDoc(doc(db, 'trading_runs', RUN_ID)))
  })

  it('denies owner create, update, and delete operations on events', async () => {
    await seed({ includeRuns: true, includeEvent: true })
    const db = authenticatedDb(OWNER_UID)
    const existing = doc(db, 'trading_runs', RUN_ID, 'events', EVENT_ID)

    await assertFails(
      setDoc(doc(db, 'trading_runs', RUN_ID, 'events', 'event-new'), {
        message: 'tampered',
      }),
    )
    await assertFails(updateDoc(existing, { message: 'tampered' }))
    await assertFails(deleteDoc(existing))
  })

  it('keeps legacy membership documents private and immutable to clients', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'tradingagents_members', OWNER_UID), {
        legacy: true,
      })
    })
    const ownerDb = authenticatedDb(OWNER_UID)
    const secondDb = authenticatedDb(SECOND_UID)
    const anonymousDb = testEnvironment.unauthenticatedContext().firestore()

    await assertFails(
      getDocFromServer(doc(anonymousDb, 'tradingagents_members', OWNER_UID)),
    )
    await assertFails(
      getDocsFromServer(collection(anonymousDb, 'tradingagents_members')),
    )
    await assertFails(
      getDocFromServer(doc(ownerDb, 'tradingagents_members', OWNER_UID)),
    )
    await assertFails(
      getDocsFromServer(collection(ownerDb, 'tradingagents_members')),
    )
    await assertFails(
      getDocsFromServer(collection(secondDb, 'tradingagents_members')),
    )
    await assertFails(
      setDoc(doc(ownerDb, 'tradingagents_members', SECOND_UID), {
        email: 'other@example.test',
      }),
    )
    await assertFails(
      setDoc(doc(anonymousDb, 'tradingagents_members', 'anonymous-write'), {
        elevated: true,
      }),
    )
    await assertFails(
      updateDoc(doc(ownerDb, 'tradingagents_members', OWNER_UID), {
        elevated: true,
      }),
    )
    await assertFails(
      deleteDoc(doc(ownerDb, 'tradingagents_members', OWNER_UID)),
    )
  })

  it('denies the owner access to unrelated collections', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'internal_config', 'private'), {
        secret: 'not browser readable',
      })
    })
    const db = authenticatedDb(OWNER_UID)

    await assertFails(getDocFromServer(doc(db, 'internal_config', 'private')))
    await assertFails(getDocsFromServer(collection(db, 'internal_config')))
  })

})
