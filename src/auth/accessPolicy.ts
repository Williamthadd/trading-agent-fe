export const TRADING_APP_ALLOWED_EMAIL = 'williamthudd@gmail.com'

export const TRADING_APP_ACCESS_DENIED_MESSAGE =
  'This Firebase account is not authorized for this workstation.'

export function isAllowedLoginEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === TRADING_APP_ALLOWED_EMAIL
}

export function isAllowedFirebaseIdentity(identity: {
  email: string | null
  emailVerified: boolean
}): boolean {
  return identity.emailVerified && isAllowedLoginEmail(identity.email)
}
