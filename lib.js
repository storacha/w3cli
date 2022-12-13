import fs from 'fs'
import path from 'path'
import { importDAG } from '@ucanto/core/delegation'
import { connect } from '@ucanto/client'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as HTTP from '@ucanto/transport/http'
import { parse } from '@ipld/dag-ucan/did'
import { create } from '@web3-storage/w3up-client'
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import { CarReader } from '@ipld/car'

export function getPkg () {
  // @ts-ignore JSON.parse works with Buffer in Node.js
  return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)))
}

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

export function filesize (bytes) {
  const size = bytes / 1024 / 1024
  return `${size.toFixed(1)}MB`
}

/**
 * Patch process.emit to skip experimental api warnings for fetch. ONLY FORWARDS!
 * source: https://stackoverflow.com/a/73525885/6490163
 */
export function unwarnify () {
  const originalEmit = process.emit
  process.emit = function (name, data) {
    if (
      name === 'warning' &&
      typeof data === 'object' &&
      data.name === 'ExperimentalWarning' &&
      data.message.includes('Fetch API')
    ) {
      return false
    }
    return originalEmit.apply(process, arguments)
  }
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
        encoder: CAR,
        decoder: CBOR,
        channel: HTTP.open({
          url: new URL(process.env.W3_ACCESS_SERVICE_URL),
          method: 'POST'
        })
      }),
      upload: connect({
        id: parse(process.env.W3_UPLOAD_SERVICE_DID),
        encoder: CAR,
        decoder: CBOR,
        channel: HTTP.open({
          url: new URL(process.env.W3_UPLOAD_SERVICE_URL),
          method: 'POST'
        })
      })
    }
  }

  return create({ store, serviceConf })
}

/**
 * @param {string} path Path to the proof file.
 */
export async function readProof (path) {
  try {
    await fs.promises.access(path, fs.constants.R_OK)
  } catch (err) {
    console.error(`Error: failed to read proof: ${err.message}`)
    process.exit(1)
  }

  const blocks = []
  try {
    const reader = await CarReader.fromIterable(fs.createReadStream(path))
    for await (const block of reader.blocks()) {
      blocks.push(block)
    }
  } catch (err) {
    console.error(`Error: failed to parse proof: ${err.message}`)
    process.exit(1)
  }

  try {
    // @ts-expect-error
    return importDAG(blocks)
  } catch (err) {
    console.error(`Error: failed to import proof: ${err.message}`)
    process.exit(1)
  }
}
