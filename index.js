import fs from 'fs'
import ora from 'ora'
import tree from 'pretty-tree'
import { Readable } from 'stream'
import * as DID from '@ipld/dag-ucan/did'
import { CarReader, CarWriter } from '@ipld/car'
import { filesFromPath } from 'files-from-path'
import { importDAG } from '@ucanto/core/delegation'
import { getClient, checkPathsExist, filesize } from './lib.js'

export async function upload (firstPath, opts) {
  const paths = checkPathsExist([firstPath, ...opts._])
  const client = await getClient()
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
 * Print out all the uploads in the current space
 */
export async function list (opts) {
  const client = await getClient()
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
  const client = await getClient()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did())
  console.log(space.did())
}

export async function registerSpace (email) {
  const client = await getClient()
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

/**
 * @param {string} proofPath
 */
export async function addSpace (proofPath) {
  const client = await getClient()
  const reader = await CarReader.fromIterable(fs.createReadStream(proofPath))
  const blocks = []
  for await (const block of reader.blocks()) {
    blocks.push(block)
  }
  // @ts-expect-error
  const delegation = importDAG(blocks)
  const space = await client.addSpace(delegation)
  console.log(space.did())
}

export async function createDelegation (audienceDID, opts) {
  const client = await getClient()
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
