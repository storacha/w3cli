import anyTest from 'ava'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execa, execaSync } from 'execa'
import * as CAR from '@ucanto/transport/car'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { create as createServer, ok, provide } from '@ucanto/server'
import * as DID from '@ipld/dag-ucan/did'
import * as dagJSON from '@ipld/dag-json'
import * as StoreCapabilities from '@web3-storage/capabilities/store'
import * as UploadCapabilities from '@web3-storage/capabilities/upload'
import * as SpaceCapabilities from '@web3-storage/capabilities/space'
import * as UCANCapabilities from '@web3-storage/capabilities/ucan'
import * as Link from 'multiformats/link'
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
 * @typedef {import('@web3-storage/w3up-client/types').StoreAddSuccess} StoreAddSuccess
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
      codec: CAR.inbound,
      validateAuthorization: () => ok({})
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
    } catch (/** @type {any} */err) {
      if (err.code === 'ENOENT') return // is ok maybe it wasn't used in the test
      throw err
    }
  }))
})

test('w3', async (t) => {
  const env = t.context.env.alice
  const res = await execa('./bin.js', [], { env })
  t.regex(res.stdout, /Available Commands/)
})

test('w3 nosuchcmd', async (t) => {
  const env = t.context.env.alice
  try {
    execaSync('./bin.js', ['nosuchcmd'], { env })
    t.fail('Expected to throw')
  } catch (/** @type {any} */err) {
    t.is(err.exitCode, 1)
    t.regex(err.stdout, /Invalid command: nosuch/)
  }
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
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        return ok(nb)
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
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ capability }) => {
        t.assert(capability.nb.shards)
        t.is(String(capability.nb.shards?.[0]), 'bagbaieracyt3l5gpf3ovcmedm6ktgvxzi6gpp7x42ffu43zrqh2qwm6q7peq')
        return ok(capability.nb)
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

  /** @type {Array<import('@web3-storage/capabilities/types').UploadListItem>} */
  const uploads = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        uploads.push({
          ...nb,
          insertedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        return ok(nb)
      }),
      list: provide(UploadCapabilities.list, () => {
        return ok({
          results: uploads,
          size: uploads.length
        })
      })
    }
  })

  t.context.setService(service)

  const list0 = await execa('./bin.js', ['ls'], { env })
  t.regex(list0.stdout, /No uploads in space/)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['ls', '--json'], { env })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 remove', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  const service = mockService({
    upload: {
      remove: provide(UploadCapabilities.remove, ({ capability }) => {
        return ok({ root: capability.nb.root })
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
      remove: provide(UploadCapabilities.remove, () => ok({}))
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
      remove: provide(StoreCapabilities.remove, () => ok({ size: 1337 }))
    },
    upload: {
      remove: provide(UploadCapabilities.remove, ({ capability }) => {
        return ok(/** @type {import('@web3-storage/w3up-client/types').UploadRemoveSuccess} */({
          root: capability.nb.root,
          shards: [
            Link.parse('bagbaiera7ciaeifwrn7oo35gxdalocfj23vkvqus2eup27wt2qcxlvta2wya'),
            Link.parse('bagbaiera7ciaeifwrn7oo35gxdalocfj23vkvqus2eup27wt2qcxlvta2wya')
          ]
        }))
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
      remove: provide(StoreCapabilities.remove, () => ok({ size: 1337 }))
    },
    upload: {
      remove: provide(UploadCapabilities.remove, ({ capability }) => {
        const { nb } = capability
        return ok({ root: nb.root })
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

  await execa('./bin.js', ['delegation', 'create', bob.did(), '-c', '*', '--output', proofPath], { env })

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

test('w3 delegation create - no capabilities', async t => {
  const env = t.context.env.alice
  await execa('./bin.js', ['space', 'create'], { env })
  const bob = await Signer.generate()
  const err = await t.throwsAsync(() => execa('./bin.js', ['delegation', 'create', bob.did()], { env }))
  t.true(err?.message.includes('Error: missing capabilities for delegation'))
})

test('w3 delegation ls', async t => {
  const env = t.context.env.alice

  const out0 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(out0.stdout.trim()).did()

  const mallory = await Signer.generate()
  await execa('./bin.js', ['delegation', 'create', mallory.did(), '-c', '*'], { env })

  const out1 = await execa('./bin.js', ['delegation', 'ls', '--json'], { env })
  const delegationData = JSON.parse(out1.stdout)

  t.is(delegationData.audience, mallory.did())
  t.is(delegationData.capabilities.length, 1)
  t.is(delegationData.capabilities[0].with, spaceDID)
  t.is(delegationData.capabilities[0].can, '*')
})

test('w3 delegation revoke', async t => {
  const env = t.context.env.alice
  const service = mockService({
    ucan: {
      revoke: provide(UCANCapabilities.revoke, () => {
        return ok({ time: Date.now() / 1000 })
      })
    }
  })
  t.context.setService(service)

  await execa('./bin.js', ['space', 'create'], { env })

  const mallory = await Signer.generate()
  const delegationPath = `${os.tmpdir()}/delegation-${Date.now()}.ucan`
  await execa('./bin.js', ['delegation', 'create', mallory.did(), '-c', '*', '-o', delegationPath], { env })

  const out1 = await execa('./bin.js', ['delegation', 'ls', '--json'], { env })
  const delegationData = JSON.parse(out1.stdout)

  // alice should be able to revoke the delegation she just created
  const out2 = await execa('./bin.js', ['delegation', 'revoke', delegationData.cid], { env })
  t.regex(out2.stdout, new RegExp(`delegation ${delegationData.cid} revoked`))

  await execa('./bin.js', ['space', 'create'], { env: t.context.env.bob })

  // bob should not be able to because he doesn't have a copy of the delegation
  /** @type {any} */
  const out3 = await t.throwsAsync(() => execa('./bin.js', ['delegation', 'revoke', delegationData.cid], { env: t.context.env.bob }))
  t.regex(out3.stderr, new RegExp(`Error: revoking ${delegationData.cid}: could not find delegation ${delegationData.cid}`))

  // but if bob passes the delegation manually, it should succeed - we don't validate that bob is able to issue the revocation,
  // it simply won't apply if it's not legitimate
  /** @type {any} */
  const out4 = await execa('./bin.js', ['delegation', 'revoke', delegationData.cid, '-p', delegationPath], { env: t.context.env.bob })
  t.regex(out4.stdout, new RegExp(`delegation ${delegationData.cid} revoked`))
})

test('w3 space add', async t => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env: aliceEnv })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bobDID, '-c', '*', '--output', proofPath], { env: aliceEnv })

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

test('w3 space info', async t => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  /** @type {import('@web3-storage/w3up-client/types').DID<'key'>} */
  const spaceDID = 'did:key:abc123'
  /** @type {import('@web3-storage/w3up-client/types').DID<'web'>} */
  const provider = 'did:web:test.web3.storage'
  const service = mockService({
    space: {
      info: provide(SpaceCapabilities.info, () => (ok({
        did: spaceDID,
        providers: [provider]
      })))
    }
  })

  t.context.setService(service)

  const { stdout } = await execa('./bin.js', ['space', 'info'], { env })

  t.true(service.space.info.called)
  t.is(service.space.info.callCount, 1)

  t.is(stdout, `
      DID: ${spaceDID.toString()}
Providers: ${provider}`)
})

test('w3 proof add', async t => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env: aliceEnv })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-delegation-${Date.now()}`)

  await execa('./bin.js', ['delegation', 'create', bobDID, '-c', '*', '--output', proofPath], { env: aliceEnv })

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

  await execa('./bin.js', ['delegation', 'create', '-c', '*', bobDID, '--output', proofPath], { env: aliceEnv })
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
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
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
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        t.is(nb.root.toString(), root)
        t.is(nb.shards?.length, 1)
        t.is(nb.shards?.[0].toString(), shard)
        return ok(nb)
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

  /** @type {Array<import('@web3-storage/capabilities/types').UploadListItem>} */
  const uploads = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        uploads.push({
          ...nb,
          updatedAt: new Date().toISOString(),
          insertedAt: new Date().toISOString()
        })
        return ok(nb)
      }),
      list: provide(UploadCapabilities.list, () => {
        return ok({ results: uploads, size: uploads.length })
      })
    }
  })

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'upload', 'ls', '--json'], { env })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 can upload rm', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  /** @type {Array<import('@web3-storage/capabilities/types').UploadAdd['nb']>} */
  const uploads = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        uploads.push(nb)
        return ok(nb)
      }),
      list: provide(UploadCapabilities.list, () => {
        return ok({ results: uploads, size: uploads.length })
      }),
      remove: provide(UploadCapabilities.remove, () => {
        return ok({})
      })
    }
  })

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  await t.throwsAsync(() => execa('./bin.js', ['can', 'upload', 'rm'], { env }), { message: /Insufficient arguments/ })
  await t.throwsAsync(() => execa('./bin.js', ['can', 'upload', 'rm', 'foo'], { env }), { message: /not a CID/ })
  await t.notThrowsAsync(() => execa('./bin.js', ['can', 'upload', 'rm', uploads[0].root.toString()], { env }))
})

test('w3 can store ls', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  /** @type {import('@web3-storage/w3up-client/types').StoreListSuccess['results']} */
  const cars = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ capability }) => {
        cars.push({
          link: capability.nb.link,
          size: capability.nb.size,
          insertedAt: new Date().toISOString()
        })
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      }),
      list: provide(StoreCapabilities.list, () => {
        return ok({ results: cars, size: cars.length })
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        return ok(nb)
      })
    }
  })

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'store', 'ls', '--json'], { env })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 can store rm', async (t) => {
  const env = t.context.env.alice

  await execa('./bin.js', ['space', 'create'], { env })

  /** @type {Array<import('@web3-storage/capabilities/types').UploadAdd['nb']>} */
  const uploads = []

  const service = mockService({
    store: {
      add: provide(StoreCapabilities.add, ({ capability }) => {
        return ok(/** @type {StoreAddSuccess} */({
          status: 'upload',
          headers: { 'x-test': 'true' },
          url: 'http://localhost:9200',
          with: capability.with,
          link: capability.nb.link
        }))
      }),
      remove: provide(StoreCapabilities.remove, () => {
        return ok({ size: 1337 })
      })
    },
    upload: {
      add: provide(UploadCapabilities.add, ({ invocation }) => {
        const { nb } = invocation.capabilities[0]
        if (!nb) throw new Error('missing nb')
        uploads.push(nb)
        return ok(nb)
      })
    }
  })

  t.context.setService(service)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const shard = uploads[0].shards?.at(0)
  if (!shard) { return t.fail('mock shard should exist') }
  await t.throwsAsync(() => execa('./bin.js', ['can', 'store', 'rm'], { env }), { message: /Insufficient arguments/ })
  await t.throwsAsync(() => execa('./bin.js', ['can', 'store', 'rm', 'foo'], { env }), { message: /not a CAR CID/ })
  await t.throwsAsync(() => execa('./bin.js', ['can', 'store', 'rm', uploads[0].root.toString()], { env }), { message: /not a CAR CID/ })
  await t.notThrowsAsync(() => execa('./bin.js', ['can', 'store', 'rm', shard.toString()], { env }))
})
