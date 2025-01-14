import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
// @ts-expect-error no typings :(
import tree from 'pretty-tree'
import { importDAG } from '@ucanto/core/delegation'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import * as Signer from '@ucanto/principal/ed25519'
import * as Link from 'multiformats/link'
import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'
import * as raw from 'multiformats/codecs/raw'
import { parse } from '@ipld/dag-ucan/did'
import * as dagJSON from '@ipld/dag-json'
import { create } from '@web3-storage/w3up-client'
import { StoreConf } from '@web3-storage/w3up-client/stores/conf'
import { CarReader } from '@ipld/car'
import chalk from 'chalk'

/**
 * @typedef {import('@web3-storage/w3up-client/types').AnyLink} AnyLink
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 * @typedef {import('@web3-storage/w3up-client/types').FileLike & { size: number }} FileLike
 * @typedef {import('@web3-storage/w3up-client/types').BlobListSuccess} BlobListSuccess
 * @typedef {import('@web3-storage/w3up-client/types').StoreListSuccess} StoreListSuccess
 * @typedef {import('@web3-storage/w3up-client/types').UploadListSuccess} UploadListSuccess
 * @typedef {import('@web3-storage/capabilities/types').FilecoinInfoSuccess} FilecoinInfoSuccess
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
 * @typedef {import('@web3-storage/access/drivers/types').Driver<import('@web3-storage/access').AgentDataExport>} Store
 */

/** 
 * Get a configured w3up store used by the CLI. 
 * @returns {Store}
 */
export function getStore() {
  return new StoreConf({ profile: process.env.W3_STORE_NAME ?? 'w3cli' })
}

/**
 * Get a new API client configured from env vars.
 * @param {{
 *   principal?: string
 *   store?: Store
 * }} options
 */
export function getClient(options = {}) {
  const store = options.store || getStore()

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
  const receiptsEndpointString = (process.env.W3UP_RECEIPTS_ENDPOINT || process.env.W3_UPLOAD_RECEIPTS_URL)
  let receiptsEndpoint
  if (receiptsEndpointString) {
    receiptsEndpoint = new URL(receiptsEndpointString)
  }
    
  let serviceConf
  if (
    accessServiceDID &&
    accessServiceURL &&
    uploadServiceDID &&
    uploadServiceURL
  ) {
    serviceConf =
      /** @type {import('@web3-storage/w3up-client/types').ServiceConf} */
      ({
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
        filecoin: connect({
          id: parse(uploadServiceDID),
          codec: CAR.outbound,
          channel: HTTP.open({
            url: new URL(uploadServiceURL),
            method: 'POST',
          }),
        }),
      })
  }

  /** @type {import('@web3-storage/w3up-client/types').ClientFactoryOptions} */
  const createConfig = { store, serviceConf, receiptsEndpoint }

  const principal = options.principal ?? process.env.W3_PRINCIPAL
  if (principal) {
    createConfig.principal = Signer.parse(principal)
  }

  return create(createConfig)
}

/**
 * @param {string} path Path to the proof file.
 */
export async function readProof(path) {
  let bytes
  try {
    const buff = await fs.promises.readFile(path)
    bytes = new Uint8Array(buff.buffer)
  } catch (/** @type {any} */ err) {
    console.error(`Error: failed to read proof: ${err.message}`)
    process.exit(1)
  }
  return readProofFromBytes(bytes)
}

/**
 * @param {Uint8Array} bytes Path to the proof file.
 */
export async function readProofFromBytes(bytes) {
  const blocks = []
  try {
    const reader = await CarReader.fromBytes(bytes)
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

/**
 * @param {UploadListSuccess} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @param {boolean} [opts.shards]
 * @param {boolean} [opts.plainTree]
 * @returns {string}
 */
export function uploadListResponseToString(res, opts = {}) {
  if (opts.json) {
    return res.results
      .map(({ root, shards }) => dagJSON.stringify({ root, shards }))
      .join('\n')
  } else if (opts.shards) {
    return res.results
      .map(({ root, shards }) => {
        const treeBuilder = opts.plainTree ? tree.plain : tree
        return treeBuilder({
          label: root.toString(),
          nodes: [
            {
              label: 'shards',
              leaf: shards?.map((s) => s.toString()),
            },
          ],
        })}
      )
      .join('\n')
  } else {
    return res.results.map(({ root }) => root.toString()).join('\n')
  }
}

/**
 * @param {BlobListSuccess} res
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 * @returns {string}
 */
export function blobListResponseToString(res, opts = {}) {
  if (opts.json) {
    return res.results
      .map(({ blob }) => dagJSON.stringify({ blob }))
      .join('\n')
  } else {
    return res.results
      .map(({ blob }) => {
        const digest = Digest.decode(blob.digest)
        const cid = Link.create(raw.code, digest)
        return `${base58btc.encode(digest.bytes)} (${cid})`
      })
      .join('\n')
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
 * @param {FilecoinInfoSuccess} res 
 * @param {object} [opts]
 * @param {boolean} [opts.raw]
 * @param {boolean} [opts.json]
 */
export function filecoinInfoToString(res, opts = {}) {
  if (opts.json) {
    return res.deals
      .map(deal => dagJSON.stringify(({
        aggregate: deal.aggregate.toString(),
        provider: deal.provider,
        dealId: deal.aux.dataSource.dealID,
        inclusion: res.aggregates.find(a => a.aggregate.toString() === deal.aggregate.toString())?.inclusion
      })))
      .join('\n')
  } else {
    if (!res.deals.length) {
      return `
      Piece CID: ${res.piece.toString()}
      Deals: Piece being aggregated and offered for deal...
      `
    }
    // not showing inclusion proof as it would just be bytes
    return `
    Piece CID: ${res.piece.toString()}
    Deals: ${res.deals.map((deal) => `
      Aggregate: ${deal.aggregate.toString()}
       Provider: ${deal.provider}
        Deal ID: ${deal.aux.dataSource.dealID}
    `).join('')}
    `
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
    return asCarLink(Link.parse(cidStr.trim()))
  } catch {
    return undefined
  }
}

/** @param {string|number|Date} now */
const startOfMonth = (now) => {
  const d = new Date(now)
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

/** @param {string|number|Date} now */
export const startOfLastMonth = (now) => {
  const d = startOfMonth(now)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}

/** @param {ReadableStream<Uint8Array>} source */
export const streamToBlob = async source => {
  const chunks = /** @type {Uint8Array[]} */ ([])
  await source.pipeTo(new WritableStream({
    write: chunk => { chunks.push(chunk) }
  }))
  return new Blob(chunks)
}

const workerPath = path.join(__dirname, 'piece-hasher-worker.js')

/** @see https://github.com/multiformats/multicodec/pull/331/files */
const pieceHasherCode = 0x1011

/** @type {import('multiformats').MultihashHasher<typeof pieceHasherCode>} */
export const pieceHasher = {
  code: pieceHasherCode,
  name: 'fr32-sha2-256-trunc254-padded-binary-tree',
  async digest (input) {
    const bytes = await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: input })
      worker.on('message', resolve)
      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Piece hasher worker exited with code: ${code}`))
      })
    })
    const digest = 
      /** @type {import('multiformats').MultihashDigest<typeof pieceHasherCode>} */
      (Digest.decode(bytes))
    return digest
  }
}
