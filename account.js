import * as Account from '@web3-storage/w3up-client/account'
import * as Result from '@web3-storage/w3up-client/result'
import * as DidMailto from '@web3-storage/did-mailto'
import { getClient } from './lib.js'
import ora from 'ora'
import { AccountDID } from '@web3-storage/access/provider'
import { Delegation } from '@web3-storage/access'
import * as ED25519 from '@ucanto/principal/ed25519'
import { sha256 } from '@ucanto/core'

/**
 * @typedef {Awaited<ReturnType<Account.login>>['ok']&{}} View
 */

/**
 * @param {DidMailto.EmailAddress} email
 */
export const login = async (email) => loginWithClient(email, await getClient())

/**
 * @param {DidMailto.EmailAddress} email
 * @param {import('@web3-storage/w3up-client').Client} client
 * @returns {Promise<View>}
 */
export const loginWithClient = async (email, client) => {
  /** @type {import('ora').Ora|undefined} */
  let spinner
  setTimeout(() => {
    spinner = ora(
      `🔗 please click the link sent to ${email} to authorize this agent`
    ).start()
  }, 1000)
  try {
    const account = Result.try(await Account.login(client, email))

    Result.try(await account.save())

    if (spinner) spinner.stop()
    console.log(`⁂ Agent was authorized by ${account.did()}`)
    return account
  } catch (err) {
    if (spinner) spinner.stop()
    console.error(err)
    process.exit(1)
  }
}

export const list = async () => {
  const client = await getClient()
  const accounts = Object.values(Account.list(client))
  for (const account of accounts) {
    console.log(account.did())
  }

  if (accounts.length === 0) {
    console.log(
      '⁂ Agent has not been authorized yet. Try `w3 login` to authorize this agent with your account.'
    )
  }
}

/**
 * Loads account from the the external proof delegated to the ED25519 principal
 * derived from the sha256 of the password. Delegation must be encoded in a CAR
 * format produced by `Delegation.archive` function. External delegation MAY
 * be fetched from a remote URL or from a local file system (if file:// URL is
 * provided).
 *
 * Loaded account and delegations side-loaded are expected to be short-lived
 * given that delegations are effectively usable by anyone who knows the URL.
 *
 * @param {import('@web3-storage/w3up-client').Client} client
 * @param {object} options
 * @param {URL} options.url
 * @param {string} [options.password]
 */
export const load = async (client, { url, password = '' }) => {
  const { ok: bytes, error: fetchError } = await fetch(url)
    .then((response) => response.arrayBuffer())
    .then((buffer) => Result.ok(new Uint8Array(buffer)))
    .catch((error) => Result.error(/** @type {Error} */ (error)))

  if (fetchError) {
    return Result.error(fetchError)
  }

  const { error: extractError, ok: delegation } =
    await Delegation.extract(bytes)
  if (extractError) {
    return Result.error(extractError)
  }

  const [capability] = delegation.capabilities

  const { ok: customer, error } = AccountDID.read(capability.with)
  if (error) {
    return Result.error(error)
  }

  const { digest } = await sha256.digest(new TextEncoder().encode(password))
  const audience = await ED25519.Signer.derive(digest)

  if (delegation.audience.did() !== audience.did()) {
    return Result.error(new RangeError('Invalid password'))
  }

  const account = new Account.Account({
    agent: client.agent,
    id: /** @type {DidMailto.DidMailto} */ (customer),
    proofs: [
      await Delegation.delegate({
        issuer: audience,
        audience: client.agent,
        capabilities: [capability],
        expiration: delegation.expiration,
        proofs: [delegation],
      }),
    ],
  })

  return Result.ok(account)
}
