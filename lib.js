import fs from 'fs'
import path from 'path'
// @ts-expect-error no typings :(
import tree from 'pretty-tree'
import { importDAG } from '@ucanto/core/delegation'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import * as Signer from '@ucanto/principal/ed25519'
import { CID } from 'multiformats/cid'
import { parse } from '@ipld/dag-ucan/did'
import { create } from '@web3-storage/w3up-client'
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import { CarReader } from '@ipld/car'

/**
 * @typedef {import('@web3-storage/w3up-client/types').AnyLink} AnyLink
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/w3up-client/types').FileLike & { size: number }} FileLike
 * @typedef {import('@web3-storage/w3up-client/types').StoreListOk} StoreListOk
 * @typedef {import('@web3-storage/w3up-client/types').UploadListOk} UploadListOk
 */

export function getPkg () {
  // @ts-ignore JSON.parse works with Buffer in Node.js
  return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)))
}

/** @param {string[]|string} paths */
export function checkPathsExist (paths) {
  paths = Array.isArray(paths) ? paths : [paths]
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.error(`The path ${path.resolve(p)} does not exist`)
      process.exit(1)
    }
  }
  return paths
}

/** @param {number} bytes */
export function filesize (bytes) {
  if (bytes < 50) return `${bytes}B` // avoid 0.0KB
  if (bytes < 50000) return `${(bytes / 1000).toFixed(1)}KB` // avoid 0.0MB
  if (bytes < 50000000) return `${(bytes / 1000 / 1000).toFixed(1)}MB` // avoid 0.0GB
  return `${(bytes / 1000 / 1000 / 1000).toFixed(1)}GB`
}

/** @param {number} bytes */
export function filesizeMB (bytes) {
  return `${(bytes / 1000 / 1000).toFixed(1)}MB`
}

/**
 * Get a new API client configured from env vars.
 */
export function getClient () {
  const store = new StoreConf({ profile: process.env.W3_STORE_NAME ?? 'w3cli' })

  let serviceConf
  if (
    process.env.W3_ACCESS_SERVICE_DID &&
    process.env.W3_ACCESS_SERVICE_URL &&
    process.env.W3_UPLOAD_SERVICE_DID &&
    process.env.W3_UPLOAD_SERVICE_URL
  ) {
    /** @type {import('@web3-storage/w3up-client/types').ServiceConf} */
    serviceConf = {
      access: connect({
        id: parse(process.env.W3_ACCESS_SERVICE_DID),
        codec: CAR.outbound,
        channel: HTTP.open({
          url: new URL(process.env.W3_ACCESS_SERVICE_URL),
          method: 'POST'
        })
      }),
      upload: connect({
        id: parse(process.env.W3_UPLOAD_SERVICE_DID),
        codec: CAR.outbound,
        channel: HTTP.open({
          url: new URL(process.env.W3_UPLOAD_SERVICE_URL),
          method: 'POST'
        })
      })
    }
  }

  /** @type {import('@web3-storage/w3up-client/types').ClientFactoryOptions} */
  const createConfig = { store, serviceConf }

  const principal = process.env.W3_PRINCIPAL
  if (principal) {
    createConfig.principal = Signer.parse(principal)
  }

  return create(createConfig)
}

/**
 * @param {string} path Path to the proof file.
 */
export async function readProof (path) {
  try {
    await fs.promises.access(path, fs.constants.R_OK)
  } catch (/** @type {any} */err) {
    console.error(`Error: failed to read proof: ${err.message}`)
    process.exit(1)
  }

  const blocks = []
  try {
    const reader = await CarReader.fromIterable(fs.createReadStream(path))
    for await (const block of reader.blocks()) {
      blocks.push(block)
    }
  } catch (/** @type {any} */err) {
    console.error(`Error: failed to parse proof: ${err.message}`)
    process.exit(1)
  }

  try {
    // @ts-expect-error
    return importDAG(blocks)
  } catch (/** @type {any} */err) {
    console.error(`Error: failed to import proof: ${err.message}`)
    process.exit(1)
  }
}

/**
 * @param {UploadListOk} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
 * @returns {string}
 */
export function uploadListResponseToString (res, opts = {}) {
  if (opts.json) {
    return res.results.map(({ root, shards }) => JSON.stringify({
      root: root.toString(),
      shards: shards?.map(s => s.toString())
    })).join('\n')
  } else if (opts.shards) {
    return res.results.map(({ root, shards }) => tree({
      label: root.toString(),
      nodes: [{
        label: 'shards',
        leaf: shards?.map(s => s.toString())
      }]
    })).join('\n')
  } else {
    return res.results.map(({ root }) => root.toString()).join('\n')
  }
}

/**
 * @param {StoreListOk} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @returns {string}
 */
export function storeListResponseToString (res, opts = {}) {
  if (opts.json) {
    return res.results.map(({ link, size }) => JSON.stringify({
      link: link.toString(),
      size
    })).join('\n')
  } else {
    return res.results.map(({ link }) => link.toString()).join('\n')
  }
}

/**
 * Return validated CARLink or undefined
 * @param {AnyLink} cid
 **/
export function asCarLink (cid) {
  if (cid.version === 1 && cid.code === CAR.codec.code) {
    return /** @type {CARLink} */ (cid)
  }
}

/**
 * Return validated CARLink type or exit the process with an error code and message
 * @param {string} cidStr
 * @param {object} console
 * @param {(msg: string) => void} console.error
 **/
export function parseCarLink (cidStr, { error } = console) {
  try {
    const cid = CID.parse(cidStr.trim())
    const car = asCarLink(cid)
    if (car === undefined) {
      error(`Error: ${cidStr} is not a CAR CID`)
    }
    return car
  } catch (err) {
    error(`Error: ${cidStr} is not a CID`)
  }
}
