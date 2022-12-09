import fs from 'fs'
import { Readable } from 'stream'
import { create } from '@web3-storage/w3up-client'
import * as DID from '@ipld/dag-ucan/did'
import { CarWriter } from '@ipld/car'

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
  const abilities = Array.isArray(opts.ability) ? opts.ability : [opts.ability]
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
