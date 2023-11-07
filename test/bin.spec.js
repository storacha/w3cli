import anyTest from 'ava'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execa, execaSync } from 'execa'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { parseLink } from '@ucanto/server'
import * as DID from '@ipld/dag-ucan/did'
import * as dagJSON from '@ipld/dag-json'
import { SpaceDID } from '@web3-storage/capabilities/utils'
import { CarReader } from '@ipld/car'
import { StoreConf } from '@web3-storage/access/stores/store-conf'
import { createServer as createHTTPServer } from './helpers/http-server.js'
import { createHTTPListener } from './helpers/ucanto.js'
import { createEnv } from './helpers/env.js'
import * as Test from './helpers/context.js'
import { pattern } from './helpers/util.js'

/**
 * @typedef {Test.Context & {
 *   server: import('./helpers/http-server').TestingServer['server']
 *   env: { alice: Record<string, string>, bob: Record<string, string> }
 * }} TestCtx
 * @typedef {import('@web3-storage/w3up-client/types').StoreAddSuccess} StoreAddSuccess
 */

const test = /** @type {import('ava').TestFn<TestCtx>} */ (anyTest)

test.beforeEach(async (t) => {
  const { server, serverURL, setRequestListener } = await createHTTPServer()

  const context = await Test.createContext()
  setRequestListener(createHTTPListener(context.connection.channel))

  t.context = Object.assign(context, {
    server,
    env: {
      alice: createEnv({
        storeName: `w3cli-test-alice-${context.service.did()}`,
        servicePrincipal: context.service,
        serviceURL: serverURL,
      }),
      bob: createEnv({
        storeName: `w3cli-test-bob-${context.service.did()}`,
        servicePrincipal: context.service,
        serviceURL: serverURL,
      }),
    },
  })
})

test.afterEach(async (t) => {
  await Test.cleanupContext(t.context)
  t.context.server.close()
  const stores = [
    t.context.env.alice.W3_STORE_NAME,
    t.context.env.bob.W3_STORE_NAME,
  ]
  await Promise.all(
    stores.map(async (name) => {
      const { path } = new StoreConf({ profile: name })
      try {
        await fs.promises.rm(path)
      } catch (/** @type {any} */ err) {
        if (err.code === 'ENOENT') return // is ok maybe it wasn't used in the test
        throw err
      }
    })
  )
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
  } catch (/** @type {any} */ err) {
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

test('w3 account ls', async (t) => {
  const { stdout } = execaSync('./bin.js', ['account ls'])
  t.regex(stdout, /has not been authorized yet/)
})

test('w3 login', async (t) => {
  const env = t.context.env.alice
  const task = execa('./bin.js', ['login', 'alice@web.mail'], { env })
  await new Promise((wake) => setTimeout(wake, 1000))
  // receive authorization request
  const mail = await t.context.mail.take()

  // confirm authorization
  await t.context.grantAccess(mail)

  const { stdout } = await task
  t.regex(stdout, /authorized by did:mailto:web.mail:alice/)
})

test.only('w3 account list', async (t) => {
  const env = t.context.env.alice
  const { stdout: noaccount } = execaSync('./bin.js', ['account list'], { env })
  t.regex(noaccount, /has not been authorized yet/)

  const task = execa('./bin.js', ['login', 'alice@web.mail'], { env })
  await new Promise((wake) => setTimeout(wake, 1000))
  // receive authorization request
  const mail = await t.context.mail.take()

  // confirm authorization
  await t.context.grantAccess(mail)

  const { stdout } = await task
  t.regex(stdout, /authorized by did:mailto:web.mail:alice/)

  const { stdout: ls } = execaSync('./bin.js', ['account list'], { env })
  t.regex(ls, /did:mailto:web.mail:alice/)
})

test('w3 space create', (t) => {
  const env = t.context.env.alice
  const { stdout } = execaSync('./bin.js', ['space', 'create'], { env })
  t.regex(stdout, /^did:key:/)
})

test('w3 up', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const output = await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], {
    env,
  })

  t.regex(
    output.stdout,
    /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
  )
  t.regex(output.stderr, /Stored 1 file/)
})

test('w3 up --car', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const output = await execa(
    './bin.js',
    ['up', '--car', 'test/fixtures/pinpie.car'],
    { env }
  )

  t.regex(
    output.stdout,
    /bafkreiajkbmpugz75eg2tmocmp3e33sg5kuyq2amzngslahgn6ltmqxxfa/
  )
  t.regex(output.stderr, /Stored 1 file/)
})

test('w3 ls', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const list0 = await execa('./bin.js', ['ls'], { env })
  t.regex(list0.stdout, /No uploads in space/)

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['ls', '--json'], { env })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 remove', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  t.throwsAsync(() => execa('./bin.js', ['rm', 'nope'], { env }), {
    message: /not a CID/,
  })

  const rm = await execa(
    './bin.js',
    ['rm', 'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm'],
    { env }
  )

  t.is(rm.exitCode, 0)
  t.is(rm.stdout, '')
})

test('w3 remove - no such upload', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const rm = await execa(
    './bin.js',
    [
      'rm',
      'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm',
      '--shards',
    ],
    { env }
  )
  t.is(rm.exitCode, 0)
  t.is(rm.stdout, '⁂ upload not found. could not determine shards to remove.')
})

test('w3 remove --shards', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const output = await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], {
    env,
  })

  t.regex(
    output.stdout,
    /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
  )

  const rm = await execa(
    './bin.js',
    [
      'rm',
      'bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea',
      '--shards',
    ],
    { env }
  )
  t.is(rm.exitCode, 0)

  t.regex(rm.stdout, /1 shard/)
  t.regex(
    rm.stderr,
    /bagbaieraxkuzouwfuphnqlbbpobywmypb26stej5vbwkelrv7chdqoxfuuea removed/
  )
})

test('w3 remove --shards - no shards to remove', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const root = parseLink(
    'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm'
  )

  // store upload without any shards
  t.context.uploadTable.insert({
    space,
    root,
    shards: [],
    issuer: Test.alice.did(),
    invocation: parseLink('bafkqaaa'),
  })

  const rm = await execa('./bin.js', ['rm', root.toString(), '--shards'], {
    env,
  })
  t.is(rm.exitCode, 0)
  t.is(rm.stdout, '⁂ no shards to remove.')
})

test('w3 delegation create', async (t) => {
  const env = t.context.env.alice
  const { bob } = Test

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = SpaceDID.from(create.stdout)

  const proofPath = path.join(
    os.tmpdir(),
    `w3cli-test-delegation-${Date.now()}`
  )

  await execa(
    './bin.js',
    ['delegation', 'create', bob.did(), '-c', '*', '--output', proofPath],
    { env }
  )

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

test('w3 delegation create - no capabilities', async (t) => {
  const env = t.context.env.alice
  const { bob } = Test

  await execa('./bin.js', ['space', 'create'], { env })

  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['delegation', 'create', bob.did()], { env })
  )
  t.true(err?.message.includes('Error: missing capabilities for delegation'))
})

test('w3 delegation ls', async (t) => {
  const env = t.context.env.alice

  const { mallory } = Test

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = SpaceDID.from(create.stdout)

  await execa('./bin.js', ['delegation', 'create', mallory.did(), '-c', '*'], {
    env,
  })

  const out1 = await execa('./bin.js', ['delegation', 'ls', '--json'], { env })
  const delegationData = JSON.parse(out1.stdout)

  t.is(delegationData.audience, mallory.did())
  t.is(delegationData.capabilities.length, 1)
  t.is(delegationData.capabilities[0].with, spaceDID)
  t.is(delegationData.capabilities[0].can, '*')
})

test('w3 delegation revoke', async (t) => {
  const env = t.context.env.alice
  const { mallory } = Test
  await execa('./bin.js', ['space', 'create'], { env })

  const delegationPath = `${os.tmpdir()}/delegation-${Date.now()}.ucan`
  await execa(
    './bin.js',
    ['delegation', 'create', mallory.did(), '-c', '*', '-o', delegationPath],
    { env }
  )

  const out1 = await execa('./bin.js', ['delegation', 'ls', '--json'], { env })
  const delegationData = JSON.parse(out1.stdout)

  // alice should be able to revoke the delegation she just created
  const out2 = await execa(
    './bin.js',
    ['delegation', 'revoke', delegationData.cid],
    { env }
  )
  t.regex(out2.stdout, new RegExp(`delegation ${delegationData.cid} revoked`))

  await execa('./bin.js', ['space', 'create'], {
    env: t.context.env.bob,
  })

  // bob should not be able to because he doesn't have a copy of the delegation
  /** @type {any} */
  const out3 = await t.throwsAsync(() =>
    execa('./bin.js', ['delegation', 'revoke', delegationData.cid], {
      env: t.context.env.bob,
    })
  )
  t.regex(
    out3.stderr,
    new RegExp(
      `Error: revoking ${delegationData.cid}: could not find delegation ${delegationData.cid}`
    )
  )

  // but if bob passes the delegation manually, it should succeed - we don't validate that bob is able to issue the revocation,
  // it simply won't apply if it's not legitimate
  /** @type {any} */
  const out4 = await execa(
    './bin.js',
    ['delegation', 'revoke', delegationData.cid, '-p', delegationPath],
    { env: t.context.env.bob }
  )
  t.regex(out4.stdout, new RegExp(`delegation ${delegationData.cid} revoked`))
})

test('w3 space add', async (t) => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], {
    env: aliceEnv,
  })
  const spaceDID = SpaceDID.from(aliceOut0.stdout.trim())

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = SpaceDID.from(bobOut0.stdout.trim())

  const proofPath = path.join(
    os.tmpdir(),
    `w3cli-test-delegation-${Date.now()}`
  )

  await execa(
    './bin.js',
    ['delegation', 'create', bobDID, '-c', '*', '--output', proofPath],
    { env: aliceEnv }
  )

  const bobOut1 = await execa('./bin.js', ['space', 'ls'], { env: bobEnv })
  t.false(bobOut1.stdout.includes(spaceDID))

  const bobOut2 = await execa('./bin.js', ['space', 'add', proofPath], {
    env: bobEnv,
  })
  t.is(bobOut2.stdout.trim(), spaceDID)

  const bobOut3 = await execa('./bin.js', ['space', 'ls'], { env: bobEnv })
  t.true(bobOut3.stdout.includes(spaceDID))
})

test('w3 space add - proof not exists', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['space', 'add', 'djcvbii'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to read proof/)
})

test('w3 space add - proof not a CAR', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['space', 'add', './package.json'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to parse proof/)
})

test('w3 space add - proof invalid', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['space', 'add', './test/fixtures/empty.car'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to import proof/)
})

test('w3 space ls', async (t) => {
  const env = t.context.env.alice

  const aliceOut0 = await execa('./bin.js', ['space', 'ls'], { env })

  const aliceOut1 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = DID.parse(aliceOut1.stdout.trim()).did()

  const aliceOut2 = await execa('./bin.js', ['space', 'ls'], { env })

  t.false(aliceOut0.stdout.includes(spaceDID))
  t.true(aliceOut2.stdout.includes(spaceDID))
})

test('w3 space use', async (t) => {
  const env = t.context.env.alice

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], { env })
  const spaceDID = SpaceDID.from(aliceOut0.stdout.trim())

  const aliceOut1 = await execa('./bin.js', ['space', 'ls'], { env })
  t.true(aliceOut1.stdout.includes(`* ${spaceDID}`))

  const spaceName = `name-${Date.now()}`
  const aliceOut2 = await execa('./bin.js', ['space', 'create', spaceName], {
    env,
  })
  const namedSpaceDID = SpaceDID.from(aliceOut2.stdout.trim())

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

test('w3 space use - space DID not exists', async (t) => {
  const env = t.context.env.alice
  const did = (await Signer.generate()).did()
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['space', 'use', did], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /space not found/)
})

test('w3 space use - space name not exists', async (t) => {
  const env = t.context.env.alice
  const name = 'spaceymcspaceface'
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['space', 'use', name], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /space not found/)
})

test('w3 space info', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })

  const spaceDID = SpaceDID.from(create.stdout)

  t.true(SpaceDID.is(spaceDID), 'prints space did')

  /** @type {import('@web3-storage/w3up-client/types').DID<'web'>} */
  const providerDID = 'did:web:test.web3.storage'

  const noprovider = await execa('./bin.js', ['space', 'info'], { env })

  t.regex(
    noprovider.stdout,
    pattern`DID: ${spaceDID}
Providers: none`,
    'space has no providers'
  )

  Test.provisionSpace(t.context, {
    space: spaceDID,
    account: 'did:mailto:web.mail:alice',
    provider: providerDID,
  })

  const withProvider = await execa('./bin.js', ['space', 'info'], { env })

  t.regex(
    withProvider.stdout,
    pattern`DID: ${spaceDID}
Providers: ${providerDID}`,
    'added provider shows up in the space info'
  )
})

test('w3 proof add', async (t) => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], {
    env: aliceEnv,
  })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(
    os.tmpdir(),
    `w3cli-test-delegation-${Date.now()}`
  )

  await execa(
    './bin.js',
    ['delegation', 'create', bobDID, '-c', '*', '--output', proofPath],
    { env: aliceEnv }
  )

  const bobOut1 = await execa('./bin.js', ['proof', 'ls'], { env: bobEnv })
  t.false(bobOut1.stdout.includes(spaceDID))

  const bobOut2 = await execa('./bin.js', ['proof', 'add', proofPath], {
    env: bobEnv,
  })
  t.true(bobOut2.stdout.includes(`with: ${spaceDID}`))

  const bobOut3 = await execa('./bin.js', ['proof', 'ls'], { env: bobEnv })
  t.true(bobOut3.stdout.includes(spaceDID))
})

test('w3 proof add - proof not exists', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['proof', 'add', 'djcvbii'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to read proof/)
})

test('w3 proof add - proof not a CAR', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['proof', 'add', './package.json'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to parse proof/)
})

test('w3 proof add - proof invalid', async (t) => {
  const env = t.context.env.alice
  const err = await t.throwsAsync(() =>
    execa('./bin.js', ['proof', 'add', './test/fixtures/empty.car'], { env })
  )
  // @ts-expect-error
  t.regex(err.stderr, /failed to import proof/)
})

test('w3 proof ls', async (t) => {
  const aliceEnv = t.context.env.alice
  const bobEnv = t.context.env.bob

  const aliceOut0 = await execa('./bin.js', ['space', 'create'], {
    env: aliceEnv,
  })
  const spaceDID = DID.parse(aliceOut0.stdout.trim()).did()

  const aliceOut1 = await execa('./bin.js', ['whoami'], { env: aliceEnv })
  const aliceDID = DID.parse(aliceOut1.stdout.trim()).did()

  const bobOut0 = await execa('./bin.js', ['whoami'], { env: bobEnv })
  const bobDID = DID.parse(bobOut0.stdout.trim()).did()

  const proofPath = path.join(os.tmpdir(), `w3cli-test-proof-${Date.now()}`)

  await execa(
    './bin.js',
    ['delegation', 'create', '-c', '*', bobDID, '--output', proofPath],
    { env: aliceEnv }
  )
  await execa('./bin.js', ['space', 'add', proofPath], { env: bobEnv })

  const bobOut1 = await execa('./bin.js', ['proof', 'ls', '--json'], {
    env: bobEnv,
  })
  const proofData = JSON.parse(bobOut1.stdout)

  t.is(proofData.issuer, aliceDID)
  t.is(proofData.capabilities.length, 1)
  t.is(proofData.capabilities[0].with, spaceDID)
  t.is(proofData.capabilities[0].can, '*')
})

test('w3 can store add', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const { stderr } = await execa(
    './bin.js',
    ['can', 'store', 'add', 'test/fixtures/pinpie.car'],
    { env }
  )

  t.regex(stderr, /Stored bag/)
})

test('w3 can upload add', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const carPath = 'test/fixtures/pinpie.car'
  const reader = await CarReader.fromBytes(await fs.promises.readFile(carPath))
  const root = (await reader.getRoots())[0]?.toString()
  t.truthy(root)

  const out0 = await execa('./bin.js', ['can', 'store', 'add', carPath], {
    env,
  })

  t.regex(out0.stderr, /Stored bag/)

  const shard = out0.stdout.trim()
  const out1 = await execa('./bin.js', ['can', 'upload', 'add', root, shard], {
    env,
  })

  t.regex(out1.stderr, /Upload added/)
})

test('w3 can upload ls', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'upload', 'ls', '--json'], {
    env,
  })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 can upload rm', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  const output = await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], {
    env,
  })

  t.regex(
    output.stdout,
    /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
  )

  await t.throwsAsync(
    () => execa('./bin.js', ['can', 'upload', 'rm'], { env }),
    { message: /Insufficient arguments/ }
  )
  await t.throwsAsync(
    () => execa('./bin.js', ['can', 'upload', 'rm', 'foo'], { env }),
    { message: /not a CID/ }
  )
  await t.notThrowsAsync(() =>
    execa(
      './bin.js',
      [
        'can',
        'upload',
        'rm',
        'bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea',
      ],
      {
        env,
      }
    )
  )
})

test('w3 can store ls', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const list1 = await execa('./bin.js', ['can', 'store', 'ls', '--json'], {
    env,
  })
  t.notThrows(() => dagJSON.parse(list1.stdout))
})

test('w3 can store rm', async (t) => {
  const env = t.context.env.alice

  const create = await execa('./bin.js', ['space', 'create'], { env })
  const space = SpaceDID.from(create.stdout)

  // provision space
  await Test.provisionSpace(t.context, {
    space,
    provider: t.context.service.did(),
    account: 'did:mailto:web.mail:alice',
  })

  await execa('./bin.js', ['up', 'test/fixtures/pinpie.jpg'], { env })

  const uploads = await t.context.uploadTable.list(space)
  const upload = uploads.results[0]

  const shard = upload.shards?.at(0)
  if (!shard) {
    return t.fail('mock shard should exist')
  }
  await t.throwsAsync(
    () => execa('./bin.js', ['can', 'store', 'rm'], { env }),
    { message: /Insufficient arguments/ }
  )
  await t.throwsAsync(
    () => execa('./bin.js', ['can', 'store', 'rm', 'foo'], { env }),
    { message: /not a CAR CID/ }
  )
  await t.throwsAsync(
    () =>
      execa('./bin.js', ['can', 'store', 'rm', upload.root.toString()], {
        env,
      }),
    { message: /not a CAR CID/ }
  )
  await t.notThrowsAsync(() =>
    execa('./bin.js', ['can', 'store', 'rm', shard.toString()], { env })
  )
})
