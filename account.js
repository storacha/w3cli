import * as Account from '@web3-storage/w3up-client/account'
import * as Result from '@web3-storage/w3up-client/result'
import * as DidMailto from '@web3-storage/did-mailto'
import { getClient } from './lib.js'
import ora, { oraPromise } from 'ora'

/**
 * @param {DidMailto.EmailAddress} email
 */
export const login = async (email) => {
  const client = await getClient()
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
    console.log(`⁂ agent was authorized by ${account.did()}`)
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
