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
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import { mockService } from './helpers/mocks.js'
import { createServer as createHTTPServer } from './helpers/http-server.js'
import { createHTTPListener } from './helpers/ucanto.js'
import { createEnv } from './helpers/env.js'

/**
 * @typedef {{
 *   server: import('./helpers/http-server').TestingServer['server']
 *   env: { alice: Record<string, string>, bob: Record<string, string> }
 *   setService: (svc: Record<string, any>) => void
 * }} TestCtx
 */

const test = /** @type {import('ava').TestFn<TestCtx>} */ (anyTest)

test.beforeEach(async t => {
  const { server, serverURL, setRequestListener } = await createHTTPServer()
  t.context.server = server

  const serviceSigner = await Signer.generate()
  t.context.setService = service => {
    const server = createServer({
      id: serviceSigner,
      service,
      decoder: CAR,
      encoder: CBOR
    })
    setRequestListener(createHTTPListener(server))
  }

  t.context.env = {
    alice: createEnv({
      storeName: `w3cli-test-alice-${serviceSigner.did()}`,
      servicePrincipal: serviceSigner,
      serviceURL: serverURL
    }),
    bob: createEnv({
      storeName: `w3cli-test-bob-${serviceSigner.did()}`,
      servicePrincipal: serviceSigner,
      serviceURL: serverURL
    })
  }
})

test.afterEach(async t => {
  t.context.server.close()
  const stores = [t.context.env.alice.W3_STORE_NAME, t.context.env.bob.W3_STORE_NAME]
  await Promise.all(stores.map(async name => {
    const { path } = new StoreConf({ profile: name })
    try {
      await fs.promises.rm(path)
    } catch (err) {
      if (err.code === 'ENOENT') return // is ok maybe it wasn't used in the test
      throw err
    }
  }))
})

test('w3', async (t) => {
  t.throws(() => {
    execaSync('./bin.js')
  }, { message: /No command specified./ })
})

test('w3 --version', (t) => {
  const { stdout } = execaSync('./bin.js', ['--version'])
  t.regex(stdout, /w3, \d.\d.\d/)
})

test('w3 whoami', (t) => {
  const { stdout } = execaSync('./bin.js', ['whoami'])
  t.regex(stdout, /^did:key:/)
})

test('w3 space create', (t) => {
  const env = t.context.env.alice
  const { stdout } = execaSync('./bin.js', ['space', 'create'], { env })
  t.regex(stdout, /^did:key:/)
})

test('w3 up', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

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

  t.context.setService(service)

  const { stderr } = await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)
  t.true(service.upload.add.called)
  t.is(service.upload.add.callCount, 1)

  t.regex(stderr, /Stored 1 file/)
})

test('w3 up --car', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

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
        t.assert(nb.shards)
        t.is(nb.shards[0]?.toString(), 'bagbaieracyt3l5gpf3ovcmedm6ktgvxzi6gpp7x42ffu43zrqh2qwm6q7peq')
        return nb
      })
    }
  })

  t.context.setService(service)

  const { stderr } = await execa('./bin.js', ['up', '--car', 'test/fixtures/pinpie.car'], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)
  t.true(service.upload.add.called)
  t.is(service.upload.add.callCount, 1)

  t.regex(stderr, /Stored 1 file/)
})

test('w3 ls', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

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

  t.context.setService(service)

  const list0 = await execa('./bin.js', ['ls'], { env })
  t.regex(list0.stdout, /No uploads in space/)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['ls', '--json'], { env })
  t.notThrows(() => CID.parse(JSON.parse(list1.stdout).root))
})

test('w3 remove', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    upload: {
      remove: provide(UploadCapabilities.remove, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        return { root: nb.root }
      })
    }
  })
  t.context.setService(service)

  t.throwsAsync(() => execa('./bin.js', ['rm', 'nope'], { env }), { message: /not a CID/ })

  const rm = await execa('./bin.js', ['rm', 'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm'], { env })
  t.is(rm.exitCode, 0)
  t.is(service.upload.remove.callCount, 1)
  t.is(service.store.remove.callCount, 0)
  t.is(rm.stdout, '')
})

test('w3 remove - no such upload', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    upload: {
      remove: provide(UploadCapabilities.remove, () => {})
    }
  })
  t.context.setService(service)

  const rm = await execa('./bin.js', ['rm', 'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm', '--shards'], { env })
  t.is(rm.exitCode, 0)
  t.is(rm.stdout, '⁂ upload not found. could not determine shards to remove.')
})

test('w3 remove --shards', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    store: {
      remove: provide(StoreCapabilities.remove, () => {})
    },
    upload: {
      remove: provide(UploadCapabilities.remove, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        return {
          root: nb.root,
          shards: [
            CID.parse('bagbaiera7ciaeifwrn7oo35gxdalocfj23vkvqus2eup27wt2qcxlvta2wya'),
            CID.parse('bagbaiera7ciaeifwrn7oo35gxdalocfj23vkvqus2eup27wt2qcxlvta2wya')
          ]
        }
      })
    }
  })
  t.context.setService(service)

  const rm = await execa('./bin.js', ['rm', 'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm', '--shards'], { env })
  t.is(rm.exitCode, 0)
  t.is(service.upload.remove.callCount, 1)
  t.is(service.store.remove.callCount, 2)
})

test('w3 remove --shards - no shards to remove', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    store: {
      remove: provide(StoreCapabilities.remove, () => {})
    },
    upload: {
      remove: provide(UploadCapabilities.remove, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        return { root: nb.root }
      })
    }
  })
  t.context.setService(service)

  const rm = await execa('./bin.js', ['rm', 'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm', '--shards'], { env })
  t.is(rm.exitCode, 0)
  t.is(service.upload.remove.callCount, 1)
  t.is(service.store.remove.callCount, 0)
  t.is(rm.stdout, '⁂ no shards to remove.')
})

test('w3 delegation create', async t => {
  const env = t.context.env.alice

  const { stdout } = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(stdout.trim()).did()

  const bob = await Signer.generate()
  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bob.did(), '--output', proofPath], { env })

  const reader = await CarReader.fromIterable(fs.createReadStream(proofPath))
  const blocks = []
  for await (const block of reader.blocks()) {
    blocks.push(block)
  }

  // @ts-expect-error
  const delegation = importDAG(blocks)
  t.is(delegation.audience.did(), bob.did())
  t.is(delegation.capabilities[0].can, '*')
  t.is(delegation.capabilities[0].with, spaceDID)
})

test('w3 delegation ls', async t => {
  const env = t.context.env.alice

  const out0 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(out0.stdout.trim()).did()

  const bob = await Signer.generate()
  await execa('./bin.js', ['delegation', 'create', bob.did()], { env })

  const out1 = await execa('./bin.js', ['delegation', 'ls', '--json'], { env })
  const delegationData = JSON.parse(out1.stdout)

  t.is(delegationData.audience, bob.did())
  t.is(delegationData.capabilities.length, 1)
  t.is(delegationData.capabilities[0].with, spaceDID)
  t.is(delegationData.capabilities[0].can, '*')
})

test('w3 space add', async t => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env: aliceEnv })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bobDID, '--output', proofPath], { env: aliceEnv })

  const bobOut1 = await execa('./bin.js', ['space', 'ls'], { env: bobEnv })
  t.false(bobOut1.stdout.includes(spaceDID))

  const bobOut2 = await execa('./bin.js', ['space', 'add', proofPath], { env: bobEnv })
  t.is(bobOut2.stdout.trim(), spaceDID)

  const bobOut3 = await execa('./bin.js', ['space', 'ls'], { env: bobEnv })
  t.true(bobOut3.stdout.includes(spaceDID))
})

test('w3 space add - proof not exists', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['space', 'add', 'djcvbii'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to read proof/)
})

test('w3 space add - proof not a CAR', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['space', 'add', './package.json'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to parse proof/)
})

test('w3 space add - proof invalid', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['space', 'add', './test/fixtures/empty.car'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to import proof/)
})

test('w3 space ls', async t => {
  const env = t.context.env.alice

  const aliceOut0 = await execa('./bin.js', ['space', 'ls'], { env })

  const aliceOut1 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(aliceOut1.stdout.trim()).did()

  const aliceOut2 = await execa('./bin.js', ['space', 'ls'], { env })

  t.false(aliceOut0.stdout.includes(spaceDID))
  t.true(aliceOut2.stdout.includes(spaceDID))
})

test('w3 space use', async t => {
  const env = t.context.env.alice

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const aliceOut1 = await execa('./bin.js', ['space', 'ls'], { env })
  t.true(aliceOut1.stdout.includes(`* ${spaceDID}`))

  const spaceName = `name-${Date.now()}`
  const aliceOut2 = await execa('./bin.js', ['space', 'create', spaceName], { env })
  const namedSpaceDID = DID.parse(aliceOut2.stdout.trim()).did()

  const aliceOut3 = await execa('./bin.js', ['space', 'ls'], { env })
  t.false(aliceOut3.stdout.includes(`* ${spaceDID}`))
  t.true(aliceOut3.stdout.includes(`* ${namedSpaceDID}`))

  await execa('./bin.js', ['space', 'use', spaceDID], { env })
  const aliceOut4 = await execa('./bin.js', ['space', 'ls'], { env })
  t.true(aliceOut4.stdout.includes(`* ${spaceDID}`))
  t.false(aliceOut4.stdout.includes(`* ${namedSpaceDID}`))

  await execa('./bin.js', ['space', 'use', spaceName], { env })
  const aliceOut5 = await execa('./bin.js', ['space', 'ls'], { env })
  t.false(aliceOut5.stdout.includes(`* ${spaceDID}`))
  t.true(aliceOut5.stdout.includes(`* ${namedSpaceDID}`))
})

test('w3 space use - space DID not exists', async t => {
  const env = t.context.env.alice
  const did = (await Signer.generate()).did()
  const err = await t.throwsAsync(() => execa('./bin.js', ['space', 'use', did], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /space not found/)
})

test('w3 space use - space name not exists', async t => {
  const env = t.context.env.alice
  const name = 'spaceymcspaceface'
  const err = await t.throwsAsync(() => execa('./bin.js', ['space', 'use', name], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /space not found/)
})

test('w3 proof add', async t => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env: aliceEnv })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bobDID, '--output', proofPath], { env: aliceEnv })

  const bobOut1 = await execa('./bin.js', ['proof', 'ls'], { env: bobEnv })
  t.false(bobOut1.stdout.includes(spaceDID))

  const bobOut2 = await execa('./bin.js', ['proof', 'add', proofPath], { env: bobEnv })
  t.true(bobOut2.stdout.includes(`with: ${spaceDID}`))

  const bobOut3 = await execa('./bin.js', ['proof', 'ls'], { env: bobEnv })
  t.true(bobOut3.stdout.includes(spaceDID))
})

test('w3 proof add - proof not exists', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['proof', 'add', 'djcvbii'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to read proof/)
})

test('w3 proof add - proof not a CAR', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['proof', 'add', './package.json'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to parse proof/)
})

test('w3 proof add - proof invalid', async t => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() => execa('./bin.js', ['proof', 'add', './test/fixtures/empty.car'], { env }))
  // @ts-expect-error
  t.regex(err.stderr, /failed to import proof/)
})

test('w3 proof ls', async t => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env: aliceEnv })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const aliceOut1 = await execa('./bin.js', ['whoami'], { env: aliceEnv })
  const aliceDID = DID.parse(aliceOut1.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-proof-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bobDID, '--output', proofPath], { env: aliceEnv })
  await execa('./bin.js', ['space', 'add', proofPath], { env: bobEnv })

  const bobOut1 = await execa('./bin.js', ['proof', 'ls', '--json'], { env: bobEnv })
  const proofData = JSON.parse(bobOut1.stdout)

  t.is(proofData.issuer, aliceDID)
  t.is(proofData.capabilities.length, 1)
  t.is(proofData.capabilities[0].with, spaceDID)
  t.is(proofData.capabilities[0].can, '*')
})

test('w3 can store add', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, () => ({
        status: 'upload',
        headers: { 'x-test': 'true' },
        url: 'http://localhost:9200'
      }))
    }
  })

  t.context.setService(service)

  const { stderr } = await execa('./bin.js', ['can', 'store', 'add', 'test/fixtures/pinpie.car'], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)

  t.regex(stderr, /Stored bag/)
})

test('w3 can upload add', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

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
        t.is(nb.root.toString(), root)
        t.is(nb.shards?.length, 1)
        t.is(nb.shards?.[0].toString(), shard)
        return nb
      })
    }
  })

  t.context.setService(service)

  const carPath = 'test/fixtures/pinpie.car'
  const reader = await CarReader.fromBytes(await fs.promises.readFile(carPath))
  const root = (await reader.getRoots())[0]?.toString()
  t.truthy(root)

  const out0 = await execa('./bin.js', ['can', 'store', 'add', carPath], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)
  t.false(service.upload.add.called)
  t.is(service.upload.add.callCount, 0)

  t.regex(out0.stderr, /Stored bag/)

  const shard = out0.stdout.trim()
  const out1 = await execa('./bin.js', ['can', 'upload', 'add', root, shard], { env })

  t.true(service.store.add.called)
  t.is(service.store.add.callCount, 1)
  t.true(service.upload.add.called)
  t.is(service.upload.add.callCount, 1)

  t.regex(out1.stderr, /Upload added/)
})

test('w3 can upload ls', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

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

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'upload', 'ls', '--json'], { env })
  t.notThrows(() => CID.parse(JSON.parse(list1.stdout).root))
})

test('w3 can store ls', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const cars = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ invocation }) => {
        cars.push({ link: invocation.root.cid })
        return ({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200'
        })
      }),
      list: provide(StoreCapabilities.list, () => {
        return { results: cars, size: cars.length }
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        return nb
      })
    }
  })

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'store', 'ls', '--json'], { env })
  t.notThrows(() => CID.parse(JSON.parse(list1.stdout).link))
})
