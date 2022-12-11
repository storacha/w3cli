import anyTest from 'ava'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execa, execaSync } from 'execa'
import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { create as createServer, provide } from '@ucanto/server'
import * as DID from '@ipld/dag-ucan/did'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'
import { CID } from 'multiformats/cid'
import { CarReader } from '@ipld/car'
import { mockService } from './helpers/mocks.js'
import { createServer as createHTTPServer } from './helpers/http-server.js'
import { createHTTPListener } from './helpers/ucanto.js'
import { createEnv } from './helpers/env.js'

/** @typedef {import('./helpers/http-server').TestingServer} TestCtx */

const test = /** @type {import('ava').TestFn<TestCtx>} */ (anyTest)

test.beforeEach(async t => {
  Object.assign(t.context, await createHTTPServer())
})

test.afterEach(t => t.context.server.close())

test('w3', async (t) => {
  t.throws(() => {
    execaSync('./bin.js')
  }, { message: /No command specified./ })
})

test('w3 --version', (t) => {
  const { stdout } = execaSync('./bin.js', ['--version'])
  t.regex(stdout, /w3, \d.\d.\d/)
})

test('w3 space create', (t) => {
  const { stdout } = execaSync('./bin.js', ['space', 'create'], { env: createEnv() })
  t.regex(stdout, /^did:key:/)
})

test('w3 up', async (t) => {
  await execa('./bin.js', ['space', 'create'], { env: createEnv() })

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, () => ({
        status: 'upload',
        headers: { 'x-test': 'true' },
        url: 'http://localhost:9200'
      }))
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        return nb
      })
    }
  })

  const serviceSigner = await Signer.generate()
  const server = createServer({
    id: serviceSigner,
    service,
    decoder: CAR,
    encoder: CBOR
  })

  t.context.setRequestListener(createHTTPListener(server))

  const env = createEnv({ servicePrincipal: serviceSigner, serviceURL: t.context.serverURL })
  const { stderr } = await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)
  t.true(service.upload.add.called)
  t.is(service.upload.add.callCount, 1)

  t.regex(stderr, /Stored 1 file/)
})

test('w3 ls', async (t) => {
  await execa('./bin.js', ['space', 'create'], { env: createEnv() })

  const uploads = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, () => ({
        status: 'upload',
        headers: { 'x-test': 'true' },
        url: 'http://localhost:9200'
      }))
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        uploads.push(nb)
        return nb
      }),
      list: provide(UploadCapabilities.list, () => {
        return { results: uploads, size: uploads.length }
      })
    }
  })

  const serviceSigner = await Signer.generate()
  const server = createServer({
    id: serviceSigner,
    service,
    decoder: CAR,
    encoder: CBOR
  })

  t.context.setRequestListener(createHTTPListener(server))

  const env = createEnv({ servicePrincipal: serviceSigner, serviceURL: t.context.serverURL })

  const list0 = await execa('./bin.js', ['ls'], { env })
  t.regex(list0.stdout, /No uploads in space/)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['ls'], { env })
  t.notThrows(() => CID.parse(list1.stdout.trim()))
})

test('w3 delegation create', async t => {
  const { stdout } = await execa('./bin.js', ['space', 'create'], { env: createEnv() })
  const spaceDID = DID.parse(stdout.trim()).did()

  const audience = await Signer.generate()
  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', audience.did(), '--output', proofPath], { env: createEnv() })

  const reader = await CarReader.fromIterable(fs.createReadStream(proofPath))
  const blocks = []
  for await (const block of reader.blocks()) {
    blocks.push(block)
  }

  // @ts-expect-error
  const delegation = importDAG(blocks)
  t.is(delegation.audience.did(), audience.did())
  t.is(delegation.capabilities[0].can, '*')
  t.is(delegation.capabilities[0].with, spaceDID)
})

// test('w3 space add', async t => {
//   const { stdout } = await execa('./bin.js', ['space', 'create'], { env: createEnv() })
//   const spaceDID = stdout.trim()

//   const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

//   await execa('./bin.js', ['delegation', 'create', proofPath], { env: createEnv() })
// })
