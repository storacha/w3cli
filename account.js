import open from 'open'
import { confirm } from '@inquirer/prompts'
import * as Account from '@web3-storage/w3up-client/account'
import * as Result from '@web3-storage/w3up-client/result'
import * as DidMailto from '@web3-storage/did-mailto'
import { authorize } from '@web3-storage/capabilities/access'
import { base64url } from 'multiformats/bases/base64'
import { getClient } from './lib.js'
import ora from 'ora'

/**
 * @typedef {Awaited<ReturnType<Account.login>>['ok']&{}} View
 */

const OAuthProviderGitHub = 'github'
const OAuthProviders = /** @type {const} */ ([OAuthProviderGitHub])

const githubOAuthClientID = process.env.GITHUB_OAUTH_CLIENT_ID || 'Ov23liRdyizj8EndxxAf'

/**
 * @param {DidMailto.EmailAddress} [email]
 * @param {object} [options]
 * @param {boolean} [options.github]
 */
export const login = async (email, options) => {
  if (email) {
    await loginWithClient(email, await getClient())
  } else if (options?.github) {
    await oauthLoginWithClient(OAuthProviderGitHub, await getClient())
  } else {
    console.error('Error: please provide email address or specify flag for alternate login method')
    process.exit(1)
  }
}

/**
 * @param {DidMailto.EmailAddress} email
 * @param {import('@web3-storage/w3up-client').Client} client
 * @returns {Promise<View>}
 */
export const loginWithClient = async (email, client) => {
  /** @type {import('ora').Ora|undefined} */
  let spinner
  const timeout = setTimeout(() => {
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
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * @param {(typeof OAuthProviders)[number]} provider OAuth provider
 * @param {import('@web3-storage/w3up-client').Client} client
 */
export const oauthLoginWithClient = async (provider, client) => {
  if (provider != OAuthProviderGitHub) {
    console.error(`Error: unknown OAuth provider: ${provider}`)
    process.exit(1)
  }

  /** @type {import('ora').Ora|undefined} */
  let spinner

  try {
    // create access/authorize request
    const request = await authorize.delegate({
      audience: client.agent.connection.id,
      issuer: client.agent.issuer,
      // agent that should be granted access
      with: client.agent.did(),
      // capabilities requested (account access)
      nb: { att: [{ can: '*' }] }
    })
    const archive = await request.archive()
    if (archive.error) {
      throw new Error('archiving access authorize delegation', { cause: archive.error })
    }

    const clientID = githubOAuthClientID
    const state = base64url.encode(archive.ok)
    const loginURL = `https://github.com/login/oauth/authorize?scope=read:user,user:email&client_id=${clientID}&state=${state}`

    if (await confirm({ message: 'Open the GitHub login URL in your default browser?' })) {
      spinner = ora('Waiting for GitHub authorization to be completed in browser...').start()
      await open(loginURL)
    } else {
      spinner = ora(`Click the link to authenticate with GitHub: ${loginURL}`).start()
    }

    const expiration = Math.floor(Date.now() / 1000) + (60 * 15)
    const account = Result.unwrap(await Account.externalLogin(client, { request: request.cid, expiration }))

    Result.unwrap(await account.save())

    if (spinner) spinner.stop()
    console.log(`⁂ Agent was authorized by ${account.did()}`)
    return account
  } catch (err) {
    if (spinner) spinner.stop()
    console.error(err)
    process.exit(1)
  }
}

/**
 *
 */
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
