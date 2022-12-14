/* eslint-env browser */
import fs from 'fs'
import { CID } from 'multiformats'
import ora from 'ora'
import { getClient } from './lib.js'

/**
 * @param {string} carPath
 */
export async function storeAdd (carPath) {
  const client = await getClient()

  const spinner = ora('Reading CAR').start()
  /** @type {Blob} */
  let blob
  try {
    const data = await fs.promises.readFile(carPath)
    blob = new Blob([data])
  } catch (err) {
    spinner.fail(`Error: failed to read CAR: ${err.message}`)
    process.exit(1)
  }

  spinner.start('Storing')
  const cid = await client.capability.store.add(blob)
  console.log(cid.toString())
  spinner.stopAndPersist({ symbol: '⁂', text: `Stored ${cid}` })
}

/**
 * @param {string} root
 * @param {string} shard
 * @param {object} opts
 * @param {string[]} opts._
 */
export async function uploadAdd (root, shard, opts) {
  const client = await getClient()

  let rootCID
  try {
    rootCID = CID.parse(root)
  } catch (err) {
    console.error(`Error: failed to parse root CID: ${root}: ${err.message}`)
    process.exit(1)
  }

  /** @type {import('@web3-storage/upload-client/types').CARLink[]} */
  const shards = []
  for (const str of [shard, ...opts._]) {
    try {
      // @ts-expect-error may not be a CAR CID...
      shards.push(CID.parse(str))
    } catch (err) {
      console.error(`Error: failed to parse shard CID: ${str}: ${err.message}`)
      process.exit(1)
    }
  }

  const spinner = ora('Adding upload').start()
  await client.capability.upload.add(rootCID, shards)
  spinner.stopAndPersist({ symbol: '⁂', text: `Upload added ${rootCID}` })
}
