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
import * as dagJSON from '@ipld/dag-json'
import { create } from '@web3-storage/w3up-client'
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import { CarReader } from '@ipld/car'
import chalk from 'chalk'

/**
 * @typedef {import('@web3-storage/w3up-client/types').AnyLink} AnyLink
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/w3up-client/types').FileLike & { size: number }} FileLike
 * @typedef {import('@web3-storage/w3up-client/types').StoreListSuccess} StoreListSuccess
 * @typedef {import('@web3-storage/w3up-client/types').UploadListSuccess} UploadListSuccess
 */

/**
 *
 */
export function getPkg() {
  // @ts-ignore JSON.parse works with Buffer in Node.js
  return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)))
}

/** @param {string[]|string} paths */
export function checkPathsExist(paths) {
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
export function filesize(bytes) {
  if (bytes < 50) return `${bytes}B` // avoid 0.0KB
  if (bytes < 50000) return `${(bytes / 1000).toFixed(1)}KB` // avoid 0.0MB
  if (bytes < 50000000) return `${(bytes / 1000 / 1000).toFixed(1)}MB` // avoid 0.0GB
  return `${(bytes / 1000 / 1000 / 1000).toFixed(1)}GB`
}

/** @param {number} bytes */
export function filesizeMB(bytes) {
  return `${(bytes / 1000 / 1000).toFixed(1)}MB`
}

/**
 * Get a new API client configured from env vars.
 */
export function getClient() {
  const store = new StoreConf({ profile: process.env.W3_STORE_NAME ?? 'w3cli' })

  if (process.env.W3_ACCESS_SERVICE_URL || process.env.W3_UPLOAD_SERVICE_URL) {
    console.warn(
      chalk.dim(
        'warning: the W3_ACCESS_SERVICE_URL and W3_UPLOAD_SERVICE_URL environment variables are deprecated and will be removed in a future release - please use W3UP_SERVICE_URL instead.'
      )
    )
  }

  if (process.env.W3_ACCESS_SERVICE_DID || process.env.W3_UPLOAD_SERVICE_DID) {
    console.warn(
      chalk.dim(
        'warning: the W3_ACCESS_SERVICE_DID and W3_UPLOAD_SERVICE_DID environment variables are deprecated and will be removed in a future release - please use W3UP_SERVICE_DID instead.'
      )
    )
  }

  const accessServiceDID =
    process.env.W3UP_SERVICE_DID || process.env.W3_ACCESS_SERVICE_DID
  const accessServiceURL =
    process.env.W3UP_SERVICE_URL || process.env.W3_ACCESS_SERVICE_URL
  const uploadServiceDID =
    process.env.W3UP_SERVICE_DID || process.env.W3_UPLOAD_SERVICE_DID
  const uploadServiceURL =
    process.env.W3UP_SERVICE_URL || process.env.W3_UPLOAD_SERVICE_URL
  let serviceConf
  if (
    accessServiceDID &&
    accessServiceURL &&
    uploadServiceDID &&
    uploadServiceURL
  ) {
    /** @type {import('@web3-storage/w3up-client/types').ServiceConf} */
    serviceConf = {
      access: connect({
        id: parse(accessServiceDID),
        codec: CAR.outbound,
        channel: HTTP.open({
          url: new URL(accessServiceURL),
          method: 'POST',
        }),
      }),
      upload: connect({
        id: parse(uploadServiceDID),
        codec: CAR.outbound,
        channel: HTTP.open({
          url: new URL(uploadServiceURL),
          method: 'POST',
        }),
      }),
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
 * @param {CarReader} reader
 */
export async function proofFromCar(reader) {
  const blocks = []
  try {
    for await (const block of reader.blocks()) {
      blocks.push(block)
    }
  } catch (/** @type {any} */ err) {
    console.error(`Error: failed to parse proof: ${err.message}`)
    process.exit(1)
  }

  try {
    // @ts-expect-error
    return importDAG(blocks)
  } catch (/** @type {any} */ err) {
    console.error(`Error: failed to import proof: ${err.message}`)
    process.exit(1)
  }
}

/** @param {string} data Base64 encoded CAR file */
export async function proofFromString (data) {
  const bytes = Buffer.from(data, 'base64')
  const reader = await CarReader.fromBytes(bytes)
  return proofFromCar(reader)
}

/** @param {string} path Path to the proof file. */
export async function proofFromPath (path) {
  try {
    await fs.promises.access(path, fs.constants.R_OK)
    const reader = await CarReader.fromIterable(fs.createReadStream(path))
    return proofFromCar(reader)
  } catch (/** @type {any} */ err) {
    console.error(`Error: failed to read proof: ${err.message}`)
    process.exit(1)
  }
}

/**
 * @param {UploadListSuccess} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
 * @returns {string}
 */
export function uploadListResponseToString(res, opts = {}) {
  if (opts.json) {
    return res.results
      .map(({ root, shards }) => dagJSON.stringify({ root, shards }))
      .join('\n')
  } else if (opts.shards) {
    return res.results
      .map(({ root, shards }) =>
        tree({
          label: root.toString(),
          nodes: [
            {
              label: 'shards',
              leaf: shards?.map((s) => s.toString()),
            },
          ],
        })
      )
      .join('\n')
  } else {
    return res.results.map(({ root }) => root.toString()).join('\n')
  }
}

/**
 * @param {StoreListSuccess} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @returns {string}
 */
export function storeListResponseToString(res, opts = {}) {
  if (opts.json) {
    return res.results
      .map(({ link, size }) => dagJSON.stringify({ link, size }))
      .join('\n')
  } else {
    return res.results.map(({ link }) => link.toString()).join('\n')
  }
}

/**
 * Return validated CARLink or undefined
 *
 * @param {AnyLink} cid
 */
export function asCarLink(cid) {
  if (cid.version === 1 && cid.code === CAR.codec.code) {
    return /** @type {CARLink} */ (cid)
  }
}

/**
 * Return validated CARLink type or exit the process with an error code and message
 *
 * @param {string} cidStr
 */
export function parseCarLink(cidStr) {
  try {
    return asCarLink(CID.parse(cidStr.trim()))
  } catch {
    return undefined
  }
}
