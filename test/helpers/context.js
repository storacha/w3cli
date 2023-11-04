import * as API from '../../api.js'

import {
  createContext,
  cleanupContext,
} from '@web3-storage/upload-api/test/context'
import { Signer } from '@ucanto/principal/ed25519'

/** did:key:z6Mkqa4oY9Z5Pf5tUcjLHLUsDjKwMC95HGXdE1j22jkbhz6r */
export const alice = Signer.parse(
  'MgCZT5vOnYZoVAeyjnzuJIVY9J4LNtJ+f8Js0cTPuKUpFne0BVEDJjEu6quFIU8yp91/TY/+MYK8GvlKoTDnqOCovCVM='
)
/** did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob */
export const bob = Signer.parse(
  'MgCYbj5AJfVvdrjkjNCxB3iAUwx7RQHVQ7H1sKyHy46Iose0BEevXgL1V73PD9snOCIoONgb+yQ9sycYchQC8kygR4qY='
)
/** did:key:z6MktafZTREjJkvV5mfJxcLpNBoVPwDLhTuMg9ng7dY4zMAL */
export const mallory = Signer.parse(
  'MgCYtH0AvYxiQwBG6+ZXcwlXywq9tI50G2mCAUJbwrrahkO0B0elFYkl3Ulf3Q3A/EvcVY0utb4etiSE8e6pi4H0FEmU='
)

export { createContext, cleanupContext }

/**
 * @typedef {Awaited<ReturnType<createContext>>} Context
 *
 * @param {Context} context
 * @param {object} input
 * @param {API.DIDKey} input.space
 * @param {API.DID<'mailto'>} input.account
 * @param {API.DID<'web'>} input.provider
 */
export const provisionSpace = async (context, { space, account, provider }) => {
  // add a provider for this space
  return await context.provisionsStorage.put({
    cause: /** @type {*} */ ({}),
    consumer: space,
    customer: account,
    provider,
  })
}
