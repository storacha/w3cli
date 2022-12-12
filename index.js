import fs from 'fs'
import ora from 'ora'
import tree from 'pretty-tree'
import { Readable } from 'stream'
import * as DID from '@ipld/dag-ucan/did'
import { CarReader, CarWriter } from '@ipld/car'
import { filesFromPath } from 'files-from-path'
import { importDAG } from '@ucanto/core/delegation'
import { getClient, checkPathsExist, filesize } from './lib.js'

/**
 * @param {string} firstPath
 * @param {object} opts
 * @param {string[]} opts._
 * @param {boolean} [opts.hidden]
 */
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
 * Print out all the uploads in the current space.
 * @param {object} opts
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
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
  const client = await getClient()
  const space = await client.createSpace(name)
  await client.setCurrentSpace(space.did())
  console.log(space.did())
}

/**
 * @param {string} email
 */
export async function registerSpace (email) {
  const client = await getClient()
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
 * @param {string} proofPath
 */
export async function addSpace (proofPath) {
  const client = await getClient()
  try {
    await fs.promises.access(proofPath, fs.constants.R_OK)
  } catch (err) {
    console.error(`Error: failed to read proof: ${err.message}`)
    process.exit(1)
  }

  const blocks = []
  try {
    const reader = await CarReader.fromIterable(fs.createReadStream(proofPath))
    for await (const block of reader.blocks()) {
      blocks.push(block)
    }
  } catch (err) {
    console.error(`Error: failed to parse proof: ${err.message}`)
    process.exit(1)
  }

  let delegation
  try {
    // @ts-expect-error
    delegation = importDAG(blocks)
  } catch (err) {
    console.error(`Error: failed to import proof: ${err.message}`)
    process.exit(1)
  }
  const space = await client.addSpace(delegation)
  console.log(space.did())
}

export async function listSpaces () {
  const client = await getClient()
  const current = client.currentSpace()
  for (const space of client.spaces()) {
    const prefix = current && current.did() === space.did() ? '* ' : '  '
    console.log(`${prefix}${space.did()} ${space.name() ?? ''}`)
  }
}

/**
 * @param {string} did
 */
export async function useSpace (did) {
  const client = await getClient()
  const spaces = client.spaces()
  const space = spaces.find(s => s.did() === did) ?? spaces.find(s => s.name() === did)
  if (!space) {
    console.error(`Error: space not found: ${did}`)
    process.exit(1)
  }
  await client.setCurrentSpace(space.did())
  console.log(space.did())
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
  const client = await getClient()
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

  const { writer, out } = CarWriter.create()
  const dest = opts.output ? fs.createWriteStream(opts.output) : process.stdout

  Readable.from(out).pipe(dest)

  for (const block of delegation.export()) {
    // @ts-expect-error
    await writer.put(block)
  }
  await writer.close()
}

/**
 * @param {object} opts
 * @param {boolean} [opts.json]
 */
export async function listDelegations (opts) {
  const client = await getClient()
  const delegations = await client.delegations()
  if (opts.json) {
    for (const delegation of delegations) {
      console.log(JSON.stringify({
        cid: delegation.cid.toString(),
        audience: delegation.audience.did(),
        capabilities: delegation.capabilities.map(c => ({ with: c.with, can: c.can }))
      }))
    }
  } else {
    for (const delegation of delegations) {
      console.log(delegation.cid.toString())
      console.log(`  audience: ${delegation.audience.did()}`)
      for (const capability of delegation.capabilities) {
        console.log(`  with: ${capability.with}`)
        console.log(`  can: ${capability.can}`)
      }
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.json]
 */
export async function listProofs (opts) {
  const client = await getClient()
  const proofs = await client.proofs()
  if (opts.json) {
    for (const proof of proofs) {
      console.log(JSON.stringify({
        cid: proof.cid.toString(),
        issuer: proof.issuer.did(),
        capabilities: proof.capabilities.map(c => ({ with: c.with, can: c.can }))
      }))
    }
  } else {
    for (const proof of proofs) {
      console.log(proof.cid.toString())
      console.log(`  issuer: ${proof.issuer.did()}`)
      for (const capability of proof.capabilities) {
        console.log(`  with: ${capability.with}`)
        console.log(`  can: ${capability.can}`)
      }
    }
  }
}

export async function whoami () {
  const client = await getClient()
  const who = client.agent()
  console.log(who.did())
}
