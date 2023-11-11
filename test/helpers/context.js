import * as API from '../../api.js'

import {
  createContext,
  cleanupContext,
} from '@web3-storage/upload-api/test/context'
import { createEnv } from './env.js'
import { Signer } from '@ucanto/principal/ed25519'
import { createServer as createHTTPServer } from './http-server.js'
import http from 'node:http'
import { createHTTPListener } from './ucanto.js'
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import * as FS from 'node:fs/promises'

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
 * @typedef {Awaited<ReturnType<createContext>>} UcantoServerTestContext
 *
 * @param {UcantoServerTestContext} context
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

/**
 * @typedef {import('@web3-storage/w3up-client/types').StoreAddSuccess} StoreAddSuccess
 * @typedef {UcantoServerTestContext & {
 *   server: import('./http-server').TestingServer['server']
 *   env: { alice: Record<string, string>, bob: Record<string, string> }
 * }} Context
 *
 * @returns {Promise<Context>}
 */
export const setup = async () => {
  const { server, serverURL, setRequestListener } = await createHTTPServer()
  const context = await createContext({ http })
  setRequestListener(createHTTPListener(context.connection.channel))
  return Object.assign(context, {
    server,
    env: {
      alice: createEnv({
        storeName: `w3cli-test-alice-${context.service.did()}`,
        servicePrincipal: context.service,
        serviceURL: serverURL,
      }),
      bob: createEnv({
        storeName: `w3cli-test-bob-${context.service.did()}`,
        servicePrincipal: context.service,
        serviceURL: serverURL,
      }),
    },
  })
}

/**
 * @param {Context} context
 */
export const teardown = async (context) => {
  await cleanupContext(context)
  context.server.close()

  const stores = [
    context.env.alice.W3_STORE_NAME,
    context.env.bob.W3_STORE_NAME,
  ]

  await Promise.all(
    stores.map(async (name) => {
      const { path } = new StoreConf({ profile: name })
      try {
        await FS.rm(path)
      } catch (/** @type {any} */ err) {
        if (err.code === 'ENOENT') return // is ok maybe it wasn't used in the test
        throw err
      }
    })
  )
}

/**
 * @param {(assert: import('entail').Assert, context: Context) => unknown} unit
 * @returns {import('entail').Test}
 */
export const test = (unit) => async (assert) => {
  const context = await setup()
  try {
    await unit(assert, context)
  } finally {
    await teardown(context)
  }
}
