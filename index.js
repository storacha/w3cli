import fs from 'fs'
import ora, { oraPromise } from 'ora'
import { Readable } from 'stream'
import { CID } from 'multiformats/cid'
import * as DID from '@ipld/dag-ucan/did'
import { CarWriter } from '@ipld/car'
import { filesFromPaths } from 'files-from-path'
import { getClient, checkPathsExist, filesize, readProof, uploadListResponseToString } from './lib.js'
import * as ucanto from '@ucanto/core'

export async function accessClaim () {
  const client = await getClient()
  await client.capability.access.claim()
}

/**
 * @param {string} email
 * @param {object} [opts]
 * @param {import('@ucanto/interface').Ability[]|import('@ucanto/interface').Ability} [opts.can]
 */
export async function authorize (email, opts = {}) {
  const client = await getClient()
  const capabilities = opts.can != null
    ? [opts.can].flat().map(can => ({ can }))
    : undefined
  /** @type {import('ora').Ora|undefined} */
  let spinner
  setTimeout(() => {
    spinner = ora(`🔗 please click the link we sent to ${email} to authorize this agent`).start()
  }, 1000)
  try {
    await client.authorize(email, { capabilities })
  } catch (err) {
    if (spinner) spinner.stop()
    console.error(err)
    process.exit(1)
  }
  if (spinner) spinner.stop()
  console.log(`⁂ agent authorized to use capabilities delegated to ${email}`)
}

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
  let totalSent = 0
  const spinner = ora('Reading files').start()
  const files = await filesFromPaths(paths, { hidden })
  const totalSize = files.reduce((total, f) => total + f.size, 0)
  spinner.stopAndPersist({ text: `${files.length} file${files.length === 1 ? '' : 's'} (${filesize(totalSize)})` })

  if (opts.car && files.length > 1) {
    console.error('Error: multiple CAR files not supported')
    process.exit(1)
  }

  spinner.start('Storing')
  /** @type {(o?: import('@web3-storage/w3up-client/src/types').UploadOptions) => Promise<import('@web3-storage/w3up-client/src/types').AnyLink>} */
  const uploadFn = opts.car
    ? client.uploadCAR.bind(client, files[0])
    : files.length === 1 && opts['no-wrap']
      ? client.uploadFile.bind(client, files[0])
      : client.uploadDirectory.bind(client, files)

  const root = await uploadFn({
    onShardStored: ({ cid, size }) => {
      totalSent += size
      spinner.stopAndPersist({ text: cid.toString() })
      spinner.start(`Storing ${Math.round((totalSent / totalSize) * 100)}%`)
    },
    shardSize: opts['shard-size'] && parseInt(opts['shard-size']),
    concurrentRequests: opts['concurrent-requests'] && parseInt(opts['concurrent-requests'])
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
export async function list (opts = {}) {
  const client = await getClient()
  let count = 0
  let res
  do {
    res = await client.capability.upload.list({ cursor: res?.cursor })
    count += res.results.length
    if (res.results.length) {
      console.log(uploadListResponseToString(res, opts))
    }
  } while (res.cursor && res.results.length)

  if (count === 0 && !opts.json) {
    console.log('⁂ No uploads in space')
    console.log('⁂ Try out `w3 up <path to files>` to upload some')
  }
}
/**
 * @param {string} rootCid
 * @param {object} opts
 * @param {boolean} [opts.shards]
 */
export async function remove (rootCid, opts) {
  let root
  try {
    root = CID.parse(rootCid.trim())
  } catch (err) {
    console.error(`Error: ${rootCid} is not a CID`)
    process.exit(1)
  }
  const client = await getClient()
  let upload
  try {
    upload = await client.capability.upload.remove(root)
  } catch (err) {
    console.error(`Remove failed: ${err.message ?? err}`)
    console.error(err)
    process.exit(1)
  }
  if (!opts.shards) {
    return
  }
  if (!upload) {
    return console.log('⁂ upload not found. could not determine shards to remove.')
  }
  if (!upload.shards || !upload.shards.length) {
    return console.log('⁂ no shards to remove.')
  }

  const { shards } = upload
  console.log(`⁂ removing ${shards.length} shard${shards.length === 1 ? '' : 's'}`)

  function removeShard (shard) {
    return oraPromise(client.capability.store.remove(shard), {
      text: `${shard}`,
      successText: `${shard} removed`,
      failText: `${shard} failed`
    })
  }

  const results = await Promise.allSettled(shards.map(removeShard))

  if (results.some(res => res.status === 'rejected')) {
    process.exit(1)
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

function findAccountsThatCanProviderAdd (client) {
  const accounts = []
  const proofs = client.proofs()
  for (const proof of proofs) {
    const allows = ucanto.Delegation.allows(proof)
    for (const resourceDID of Object.keys(allows)) {
      if (resourceDID.startsWith('did:mailto:') && allows[resourceDID]['provider/add']) {
        accounts.push(resourceDID)
      }
    }
  }
  return accounts
}

// TODO: extract to external library along with its counterpart in https://github.com/web3-storage/w3protocol/blob/main/packages/access-client/src/utils/did-mailto.js
function createEmailFromDidMailto (did) {
  const parts = did.split(':')
  return `${parts[3]}@${parts[2]}`
}

/**
 * @param {string} [opts.email]
 * @param {string} [opts.provider]
 */
export async function registerSpace (opts) {
  const client = await getClient()
  let accountEmail = opts.email
  if (!accountEmail) {
    const accounts = findAccountsThatCanProviderAdd(client)
    if (accounts.length === 1) {
      accountEmail = createEmailFromDidMailto(accounts[0])
    } else {
      if (accounts.length > 1) {
        console.error('Error: you are authorized to use more than one account and have not specified which one you would like to use to register this space.')
      } else {
        console.error('Error: please authorize before registering spaces')
      }
      process.exit(1)
    }
  }
  let space = client.currentSpace()
  if (space === undefined) {
    space = await client.createSpace()
    await client.setCurrentSpace(space.did())
  }
  /** @type {import('ora').Ora|undefined} */
  const spinner = ora('registering your space').start()

  try {
    await client.registerSpace(accountEmail, { provider: opts.provider })
  } catch (err) {
    if (spinner) spinner.stop()
    if (err.message.startsWith('Space already registered')) {
      console.error('Error: space already registered.')
    } else if (err.message.startsWith('no proofs available')) {
      console.error(`Error: you are not authorized as ${accountEmail}`)
    } else {
      console.error(err)
    }
    process.exit(1)
  }
  if (spinner) spinner.stop()
  console.log(`⁂ space registered to ${accountEmail}`)
}

/**
 * @param {string} proofPath
 */
export async function addSpace (proofPath) {
  const client = await getClient()
  const delegation = await readProof(proofPath)
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
 * @param {number} [opts.expiration]
 * @param {string} [opts.output]
 */
export async function createDelegation (audienceDID, opts) {
  const client = await getClient()
  if (client.currentSpace() == null) {
    throw new Error('no current space, use `w3 space register` to create one.')
  }
  const audience = DID.parse(audienceDID)
  const abilities = opts.can ? [opts.can].flat() : []
  if (!abilities.length) {
    console.error('Error: missing capabilities for delegation')
    process.exit(1)
  }
  const audienceMeta = {}
  if (opts.name) audienceMeta.name = opts.name
  if (opts.type) audienceMeta.type = opts.type
  const expiration = opts.expiration || Infinity

  // @ts-expect-error createDelegation should validate abilities
  const delegation = await client.createDelegation(audience, abilities, {
    expiration,
    audienceMeta
  })

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
  const delegations = client.delegations()
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
      if (delegation.proofs.length) {
        console.log('  proofs:')
        for (const proof of delegation.proofs) {
          if (ucanto.isDelegation(proof)) {
            console.log(`    issuer: ${proof.issuer.did()}`)
            console.log(`    audience: ${proof.audience.did()}`)
            for (const capability of proof.capabilities) {
              console.log(`    with: ${capability.with}`)
              console.log(`    can: ${capability.can}`)
            }
          } else {
            console.log(`    link: ${proof}`)
          }
        }
      }
    }
  }
}

/**
 * @param {string} proofPath
 * @param {object} opts
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.dry-run]
 */
export async function addProof (proofPath, opts) {
  const client = await getClient()
  let proof
  try {
    proof = await readProof(proofPath)
    if (!opts['dry-run']) {
      await client.addProof(proof)
    }
  } catch (err) {
    console.log(`Error: ${err.message}`)
    process.exit(1)
  }
  if (opts.json) {
    console.log(JSON.stringify(proof.toJSON()))
  } else {
    console.log(proof.cid.toString())
    console.log(`  issuer: ${proof.issuer.did()}`)
    for (const capability of proof.capabilities) {
      console.log(`  with: ${capability.with}`)
      console.log(`  can: ${capability.can}`)
    }
  }
}

/**
 * @param {object} opts
 * @param {boolean} [opts.json]
 */
export async function listProofs (opts) {
  const client = await getClient()
  const proofs = client.proofs()
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
      console.log(`  audience: ${proof.audience.did()}`)
      for (const capability of proof.capabilities) {
        console.log(`  with: ${capability.with}`)
        console.log(`  can: ${capability.can}`)
      }
      if (proof.proofs.length) {
        console.log('  proofs:')
        for (const inner of proof.proofs) {
          if (ucanto.isDelegation(inner)) {
            console.log(`    issuer: ${inner.issuer.did()}`)
            console.log(`    audience: ${inner.audience.did()}`)
            for (const capability of inner.capabilities) {
              console.log(`    with: ${capability.with}`)
              console.log(`    can: ${capability.can}`)
            }
          } else {
            console.log(`    link: ${proof}`)
          }
        }
      }
    }
  }
}

export async function whoami () {
  const client = await getClient()
  const who = client.agent()
  console.log(who.did())
}
