import fs from 'fs'
import ora from 'ora'
import tree from 'pretty-tree'
import { Readable } from 'stream'
import { create } from '@web3-storage/w3up-client'
import * as DID from '@ipld/dag-ucan/did'
import { CarWriter } from '@ipld/car'
import { filesFromPath } from 'files-from-path'
import { checkPathsExist, filesize } from './lib.js'

/**
 * @param {string} firstPath
 * @param {object} opts
 * @param {string[]} opts._
 * @param {boolean} [opts.hidden]
 */
export async function upload (firstPath, opts) {
  const paths = checkPathsExist([firstPath, ...opts._])
  const client = await create()
  const hidden = !!opts.hidden
  const files = []
  let totalSize = 0
  let totalSent = 0
  const spinner = ora('Packing files').start()
  for (const p of paths) {
    for await (const file of filesFromPath(p, { hidden })) {
      totalSize += file.size
      files.push({ name: file.name, stream: () => Readable.toWeb(file.stream()) })
      spinner.text = `Packing ${files.length} file${files.length === 1 ? '' : 's'} (${filesize(totalSize)})`
    }
  }
  spinner.start('Storing')
  // @ts-ignore
  const root = await client.uploadDirectory(files, {
    onShardStored: ({ cid, size }) => {
      totalSent += size
      spinner.stopAndPersist({ text: cid.toString() })
      spinner.start(`Storing ${Math.round((totalSent / totalSize) * 100)}%`)
    }
  })
  spinner.stopAndPersist({ symbol: '⁂', text: `Stored ${files.length} file${files.length === 1 ? '' : 's'}` })
  console.log(`⁂ https://w3s.link/ipfs/${root}`)
}

/**
 * Print out all the uploads in the current space.
 * @param {object} opts
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
 */
export async function list (opts) {
  const client = await create()
  let count = 0
  let res
  do {
    res = await client.capability.upload.list()
    count += res.results.length
    if (res.results.length) {
      if (opts.json) {
        console.log(res.results.map(({ root, shards }) => JSON.stringify({
          root: root.toString(),
          shards: shards?.map(s => s.toString())
        })).join('\n'))
      } else if (opts.shards) {
        console.log(res.results.map(({ root, shards }) => tree({
          label: root.toString(),
          nodes: [{
            label: 'shards',
            leaf: shards?.map(s => s.toString())
          }]
        })).join('\n'))
      } else {
        console.log(res.results.map(({ root }) => root.toString()).join('\n'))
      }
    }
  } while (res.cursor && res.results.length)

  if (count === 0 && !opts.json) {
    console.log('⁂ No uploads in space')
    console.log('⁂ Try out `w3 up <path to files>` to upload some')
  }
}

/**
 * @param {string} name
 */
export async function createSpace (name) {
  const client = await create()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did())
  console.log(space.did)
}

/**
 * @param {string} email
 */
export async function registerSpace (email) {
  const client = await create()
  let space = client.currentSpace()
  if (space === undefined) {
    space = await client.createSpace()
    await client.setCurrentSpace(space.did())
  }
  /** @type {import('ora').Ora|undefined} */
  let spinner
  setTimeout(() => {
    spinner = ora(`🔗 please click the link we sent to ${email} to register your space`).start()
  }, 1000)
  try {
    await client.registerSpace(email)
  } catch (err) {
    if (spinner) spinner.stop()
    if (err.message.startsWith('Space already registered')) {
      console.error('Error: space already registered.')
    } else {
      console.error(err)
    }
    process.exit(1)
  }
  if (spinner) spinner.stop()
  console.log(`⁂ space registered to ${email}`)
}

/**
 * @param {string} audienceDID
 * @param {object} opts
 * @param {string[]|string} opts.can
 * @param {string} [opts.name]
 * @param {string} [opts.type]
 * @param {string} [opts.output]
 */
export async function createDelegation (audienceDID, opts) {
  const client = await create()
  if (client.currentSpace() == null) {
    throw new Error('no current space, use `w3 space register` to create one.')
  }
  const audience = DID.parse(audienceDID)
  const abilities = Array.isArray(opts.can) ? opts.can : [opts.can]
  const audienceMeta = {}
  if (opts.name) audienceMeta.name = opts.name
  if (opts.type) audienceMeta.type = opts.type

  // @ts-expect-error createDelegation should validate abilities
  const delegation = await client.createDelegation(audience, abilities, { audienceMeta })
  delegation.export()

  const { writer, out } = CarWriter.create()
  const dest = opts.output ? fs.createWriteStream(opts.output) : process.stdout

  Readable.from(out).pipe(dest)

  for (const block of delegation.export()) {
    await writer.put(block)
  }
  await writer.close()
}
