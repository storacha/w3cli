import fs from 'fs'
import ora from 'ora'
import { Readable } from 'stream'
import { create } from '@web3-storage/w3up-client'
import * as DID from '@ipld/dag-ucan/did'
import { CarWriter } from '@ipld/car'
import ora from 'ora'
import { filesFromPath } from 'files-from-path'
import { checkPathsExist, filesize } from './lib.js'

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

export async function createSpace (name) {
  const client = await create()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did)
  console.log(space.did)
}

export async function registerSpace (email) {
  const client = await create()
  let space = client.currentSpace()
  if (space === undefined) {
    space = await client.setCurrentSpace(space.did())
    await client.setCurrentSpace(space.did())
  }
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
