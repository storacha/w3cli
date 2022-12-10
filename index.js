import fs from 'fs'
import { Readable } from 'stream'
import { create } from '@web3-storage/w3up-client'
import * as DID from '@ipld/dag-ucan/did'
import { CarWriter } from '@ipld/car'
import tree from 'pretty-tree'

/**
 * Print out all the uploads in the current space
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
          shards: shards.map(s => s.toString())
        })).join('\n'))
      } else if (opts.shards) {
        console.log(res.results.map(({ root, shards }) => tree({
          label: root.toString(),
          nodes: [{
            label: 'shards',
            leaf: shards.map(s => s.toString())
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

export async function createSpace (name) {
  const client = await create()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did)
}

export async function registerSpace (address) {
  const client = await create()
  if (await client.currentSpace() === undefined) {
    await client.setCurrentSpace((await client.createSpace()).did)
  }
  try {
    await client.registerSpace(address)
  } catch (err) {
    console.error('registration failed: ', err)
  }
}

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
