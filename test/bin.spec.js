import fs from 'fs'
import os from 'os'
import path from 'path'
import * as Signer from '@ucanto/principal/ed25519'
import { importDAG } from '@ucanto/core/delegation'
import { parseLink } from '@ucanto/server'
import * as DID from '@ipld/dag-ucan/did'
import * as dagJSON from '@ipld/dag-json'
import { SpaceDID } from '@web3-storage/capabilities/utils'
import { CarReader } from '@ipld/car'
import { test } from './helpers/context.js'
import * as Test from './helpers/context.js'
import { pattern, match } from './helpers/util.js'
import * as Command from './helpers/process.js'
import { Absentee, ed25519 } from '@ucanto/principal'
import * as DIDMailto from '@web3-storage/did-mailto'
import { UCAN, Provider } from '@web3-storage/capabilities'
import * as ED25519 from '@ucanto/principal/ed25519'
import { sha256, delegate } from '@ucanto/core'
import * as Result from '@web3-storage/w3up-client/result'
import { base64 } from 'multiformats/bases/base64'
import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'

const w3 = Command.create('./bin.js')

export const testW3 = {
  w3: test(async (assert, { env }) => {
    const { output } = await w3.env(env.alice).join()

    assert.match(output, /Available Commands/)
  }),

  'w3 nosuchcmd': test(async (assert, context) => {
    const { status, output } = await w3
      .args(['nosuchcmd'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(status.code, 1)
    assert.match(output, /Invalid command: nosuch/)
  }),

  'w3 --version': test(async (assert, context) => {
    const { output, status } = await w3.args(['--version']).join()

    assert.equal(status.code, 0)
    assert.match(output, /w3, \d.\d.\d/)
  }),

  'w3 whoami': test(async (assert) => {
    const { output } = await w3.args(['whoami']).join()

    assert.match(output, /^did:key:/)
  }),
}

export const testAccount = {
  'w3 account ls': test(async (assert, context) => {
    const { output } = await w3
      .env(context.env.alice)
      .args(['account ls'])
      .join()

    assert.match(output, /has not been authorized yet/)
  }),

  'w3 login': test(async (assert, context) => {
    const login = w3
      .args(['login', 'alice@web.mail'])
      .env(context.env.alice)
      .fork()

    const line = await login.error.lines().take().text()
    assert.match(line, /please click the link sent/)

    // receive authorization request
    const mail = await context.mail.take()

    // confirm authorization
    await context.grantAccess(mail)

    const message = await login.output.text()

    assert.match(message ?? '', /authorized by did:mailto:web.mail:alice/)
  }),

  'w3 account list': test(async (assert, context) => {
    await login(context)

    const { output } = await w3
      .env(context.env.alice)
      .args(['account list'])
      .join()

    assert.match(output, /did:mailto:web.mail:alice/)
  }),
}

export const testSpace = {
  'w3 space create': test(async (assert, context) => {
    const command = w3.args(['space', 'create', '--no-gateway-authorization']).env(context.env.alice).fork()

    const line = await command.output.take(1).text()

    assert.match(line, /What would you like to call this space/)

    await command.terminate().join().catch()
  }),

  'w3 space create home': test(async (assert, context) => {
    const create = w3
      .args(['space', 'create', 'home', '--no-gateway-authorization'])
      .env(context.env.alice)
      .fork()

    const message = await create.output.take(1).text()

    const [prefix, key, suffix] = message.split('\n\n')

    assert.match(prefix, /secret recovery key/)
    assert.match(suffix, /hit enter to reveal the key/)

    const secret = key.replaceAll(/[\s\n]+/g, '')
    assert.equal(secret, '█'.repeat(secret.length), 'key is concealed')

    assert.ok(secret.length > 60, 'there are several words')

    await create.terminate().join().catch()
  }),

  'w3 space create home --no-caution': test(async (assert, context) => {
    const create = w3
      .args(['space', 'create', 'home', '--no-caution', '--no-gateway-authorization'])
      .env(context.env.alice)
      .fork()

    const message = await create.output.lines().take(6).text()

    const lines = message.split('\n').filter((line) => line.trim() !== '')
    const [prefix, key, suffix] = lines

    assert.match(prefix, /secret recovery key/)
    assert.match(suffix, /billing account/, 'no heads up')
    const words = key.trim().split(' ')
    assert.ok(
      words.every((word) => [...word].every((letter) => letter !== '█')),
      'key is revealed'
    )
    assert.ok(words.length > 20, 'there are several words')

    await create.terminate().join().catch()
  }),

  'w3 space create my-space --no-recovery': test(async (assert, context) => {
    const create = w3
      .args(['space', 'create', 'home', '--no-recovery', '--no-gateway-authorization'])
      .env(context.env.alice)
      .fork()

    const line = await create.output.lines().take().text()

    assert.match(line, /billing account/, 'no paper recovery')

    await create.terminate().join().catch()
  }),

  'w3 space create my-space --no-recovery (logged-in)': test(
    async (assert, context) => {
      await login(context)

      await selectPlan(context)

      const create = w3
        .args(['space', 'create', 'home', '--no-recovery', '--no-gateway-authorization'])
        .env(context.env.alice)
        .fork()

      const lines = await create.output.lines().take(2).text()

      assert.match(lines, /billing account is set/i)

      await create.terminate().join().catch()
    }
  ),

  'w3 space create my-space --no-recovery (multiple accounts)': test(
    async (assert, context) => {
      await login(context, { email: 'alice@web.mail' })
      await login(context, { email: 'alice@email.me' })

      const create = w3
        .args(['space', 'create', 'my-space', '--no-recovery', '--no-gateway-authorization'])
        .env(context.env.alice)
        .fork()

      const output = await create.output.take(2).text()

      assert.match(
        output,
        /choose an account you would like to use/,
        'choose account'
      )

      assert.ok(output.includes('alice@web.mail'))
      assert.ok(output.includes('alice@email.me'))

      create.terminate()
    }
  ),

  'w3 space create void --skip-paper --provision-as unknown@web.mail --skip-email':
    test(async (assert, context) => {
      const { output, error } = await w3
        .env(context.env.alice)
        .args([
          'space',
          'create',
          'home',
          '--no-recovery',
          '--no-gateway-authorization',
          '--customer',
          'unknown@web.mail',
          '--no-account',
        ])
        .join()
        .catch()

      assert.match(output, /billing account/)
      assert.match(output, /Skipped billing setup/)
      assert.match(error, /not authorized by unknown@web\.mail/)
    }),

  'w3 space create home --no-recovery --customer alice@web.mail --no-account':
    test(async (assert, context) => {
      await login(context, { email: 'alice@web.mail' })

      selectPlan(context)

      const create = await w3
        .args([
          'space',
          'create',
          'home',
          '--no-recovery',
          '--no-gateway-authorization',
          '--customer',
          'alice@web.mail',
          '--no-account',
        ])
        .env(context.env.alice)
        .join()

      assert.match(create.output, /Billing account is set/)

      const info = await w3
        .args(['space', 'info'])
        .env(context.env.alice)
        .join()

      assert.match(info.output, /Providers: did:web:/)
    }),

  'w3 space create home --no-recovery --customer alice@web.mail --account alice@web.mail':
    test(async (assert, context) => {
      const email = 'alice@web.mail'
      await login(context, { email })
      await selectPlan(context, { email })

      const { output } = await w3
        .args([
          'space',
          'create',
          'home',
          '--no-recovery',
          '--no-gateway-authorization',
          '--customer',
          email,
          '--account',
          email,
        ])
        .env(context.env.alice)
        .join()

      assert.match(output, /account is authorized/i)

      const result = await context.delegationsStorage.find({
        audience: DIDMailto.fromEmail(email),
      })

      assert.ok(
        result.ok?.find((d) => d.capabilities[0].can === '*'),
        'account has been delegated access to the space'
      )
    }),

  'w3 space create home --no-recovery (blocks until plan is selected)': test(
    async (assert, context) => {
      const email = 'alice@web.mail'
      await login(context, { email })

      context.plansStorage.get = async () => {
        return {
          ok: { product: 'did:web:free.web3.storage', updatedAt: 'now' },
        }
      }

      const { output, error } = await w3
        .env(context.env.alice)
        .args(['space', 'create', 'home', '--no-recovery', '--no-gateway-authorization'])
        .join()

      assert.match(output, /billing account is set/i)
      assert.match(error, /wait.*plan.*select/i)
    }
  ),

  'storacha space create home --no-recovery --customer alice@web.mail --account alice@web.mail --authorize-gateway-services':
    test(async (assert, context) => {
      const email = 'alice@web.mail'
      await login(context, { email })
      await selectPlan(context, { email })

      const serverId = context.connection.id
      const serverURL = context.serverURL

      const { output } = await w3
        .args([
          'space',
          'create',
          'home',
          '--no-recovery',
          '--customer',
          email,
          '--account',
          email,
          '--authorize-gateway-services',
          `[{"id":"${serverId}","serviceEndpoint":"${serverURL}"}]`,
        ])
        .env(context.env.alice)
        .join()

      assert.match(output, /account is authorized/i)

      const result = await context.delegationsStorage.find({
        audience: DIDMailto.fromEmail(email),
      })

      assert.ok(
        result.ok?.find((d) => d.capabilities[0].can === '*'),
        'account has been delegated access to the space'
      )
    }),

  'w3 space add': test(async (assert, context) => {
    const { env } = context

    const spaceDID = await loginAndCreateSpace(context, { env: env.alice })

    const whosBob = await w3.args(['whoami']).env(env.bob).join()

    const bobDID = SpaceDID.from(whosBob.output.trim())

    const proofPath = path.join(
      os.tmpdir(),
      `w3cli-test-delegation-${Date.now()}`
    )

    await w3
      .args([
        'delegation',
        'create',
        bobDID,
        '-c',
        'store/*',
        'upload/*',
        '--output',
        proofPath,
      ])
      .env(env.alice)
      .join()

    const listNone = await w3.args(['space', 'ls']).env(env.bob).join()
    assert.ok(!listNone.output.includes(spaceDID))

    const add = await w3.args(['space', 'add', proofPath]).env(env.bob).join()
    assert.equal(add.output.trim(), spaceDID)

    const listSome = await w3.args(['space', 'ls']).env(env.bob).join()
    assert.ok(listSome.output.includes(spaceDID))
  }),

  'w3 space add `base64 proof car`': test(async (assert, context) => {
    const { env } = context
    const spaceDID = await loginAndCreateSpace(context, { env: env.alice })
    const whosBob = await w3.args(['whoami']).env(env.bob).join()
    const bobDID = SpaceDID.from(whosBob.output.trim())
    const res = await w3
      .args([
        'delegation',
        'create',
        bobDID,
        '-c',
        'store/*',
        'upload/*',
        '--base64'
      ])
      .env(env.alice)
      .join()

    const listNone = await w3.args(['space', 'ls']).env(env.bob).join()
    assert.ok(!listNone.output.includes(spaceDID))

    const add = await w3.args(['space', 'add', res.output]).env(env.bob).join()
    assert.equal(add.output.trim(), spaceDID)

    const listSome = await w3.args(['space', 'ls']).env(env.bob).join()
    assert.ok(listSome.output.includes(spaceDID))
  }),

  'w3 space add invalid/path': test(async (assert, context) => {
    const fail = await w3
      .args(['space', 'add', 'djcvbii'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.ok(!fail.status.success())
    assert.match(fail.error, /failed to read proof/)
  }),

  'w3 space add not-a-car.gif': test(async (assert, context) => {
    const fail = await w3
      .args(['space', 'add', './package.json'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(fail.status.success(), false)
    assert.match(fail.error, /failed to parse proof/)
  }),

  'w3 space add empty.car': test(async (assert, context) => {
    const fail = await w3
      .args(['space', 'add', './test/fixtures/empty.car'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(fail.status.success(), false)
    assert.match(fail.error, /failed to import proof/)
  }),

  'w3 space ls': test(async (assert, context) => {
    const emptyList = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()

    const spaceDID = await loginAndCreateSpace(context)

    const spaceList = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()

    assert.ok(!emptyList.output.includes(spaceDID))
    assert.ok(spaceList.output.includes(spaceDID))
  }),

  'w3 space use': test(async (assert, context) => {
    const spaceDID = await loginAndCreateSpace(context, {
      env: context.env.alice,
    })

    const listDefault = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()
    assert.ok(listDefault.output.includes(`* ${spaceDID}`))

    const spaceName = 'laundry'

    const newSpaceDID = await createSpace(context, { name: spaceName })

    const listNewDefault = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()

    assert.equal(
      listNewDefault.output.includes(`* ${spaceDID}`),
      false,
      'old space is not default'
    )
    assert.equal(
      listNewDefault.output.includes(`* ${newSpaceDID}`),
      true,
      'new space is the default'
    )

    assert.equal(
      listNewDefault.output.includes(spaceDID),
      true,
      'old space is still listed'
    )

    await w3.args(['space', 'use', spaceDID]).env(context.env.alice).join()
    const listSetDefault = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()

    assert.equal(
      listSetDefault.output.includes(`* ${spaceDID}`),
      true,
      'spaceDID is default'
    )
    assert.equal(
      listSetDefault.output.includes(`* ${newSpaceDID}`),
      false,
      'new space is not default'
    )

    await w3.args(['space', 'use', spaceName]).env(context.env.alice).join()
    const listNamedDefault = await w3
      .args(['space', 'ls'])
      .env(context.env.alice)
      .join()

    assert.equal(listNamedDefault.output.includes(`* ${spaceDID}`), false)
    assert.equal(listNamedDefault.output.includes(`* ${newSpaceDID}`), true)
  }),

  'w3 space use did:key:unknown': test(async (assert, context) => {
    const space = await Signer.generate()

    const useSpace = await w3
      .args(['space', 'use', space.did()])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(useSpace.error, /space not found/)
  }),

  'w3 space use notfound': test(async (assert, context) => {
    const useSpace = await w3
      .args(['space', 'use', 'notfound'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(useSpace.error, /space not found/)
  }),

  'w3 space info': test(async (assert, context) => {
    const spaceDID = await loginAndCreateSpace(context, {
      customer: null,
    })

    /** @type {import('@web3-storage/w3up-client/types').DID<'web'>} */
    const providerDID = 'did:web:test.web3.storage'

    const infoWithoutProvider = await w3
      .args(['space', 'info'])
      .env(context.env.alice)
      .join()

    assert.match(
      infoWithoutProvider.output,
      pattern`DID: ${spaceDID}\nProviders: .*none`,
      'space has no providers'
    )

    assert.match(
      infoWithoutProvider.output,
      pattern`Name: home`,
      'space name is set'
    )

    Test.provisionSpace(context, {
      space: spaceDID,
      account: 'did:mailto:web.mail:alice',
      provider: providerDID,
    })

    const infoWithProvider = await w3
      .args(['space', 'info'])
      .env(context.env.alice)
      .join()

    assert.match(
      infoWithProvider.output,
      pattern`DID: ${spaceDID}\nProviders: .*${providerDID}`,
      'added provider shows up in the space info'
    )

    const infoWithProviderJson = await w3
      .args(['space', 'info', '--json'])
      .env(context.env.alice)
      .join()

    assert.deepEqual(JSON.parse(infoWithProviderJson.output), {
      did: spaceDID,
      providers: [providerDID],
      name: 'home'
    })
  }),

  'w3 space provision --coupon': test(async (assert, context) => {
    const spaceDID = await loginAndCreateSpace(context, { customer: null })

    assert.deepEqual(
      await context.provisionsStorage.getStorageProviders(spaceDID),
      { ok: [] },
      'space has no providers yet'
    )

    const archive = await createCustomerSession(context)
    context.router['/proof.car'] = async () => {
      return {
        status: 200,
        headers: { 'content-type': 'application/car' },
        body: archive,
      }
    }

    const url = new URL('/proof.car', context.serverURL)
    const provision = await w3
      .env(context.env.alice)
      .args(['space', 'provision', '--coupon', url.href])
      .join()

    assert.match(provision.output, /Billing account is set/)

    const info = await w3.env(context.env.alice).args(['space', 'info']).join()

    assert.match(
      info.output,
      pattern`Providers: ${context.service.did()}`,
      'space got provisioned'
    )
  }),
}

export const testW3Up = {
  'w3 up': test(async (assert, context) => {
    const email = 'alice@web.mail'
    await login(context, { email })
    await selectPlan(context, { email })

    const create = await w3
      .args([
        'space',
        'create',
        'home',
        '--no-recovery',
        '--no-account',
        '--no-gateway-authorization',
        '--customer',
        email,
      ])
      .env(context.env.alice)
      .join()

    assert.ok(create.status.success())

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
    )
    assert.match(up.error, /Stored 1 file/)
  }),

  'w3 up --no-wrap': test(async (assert, context) => {
    const email = 'alice@web.mail'
    await login(context, { email })
    await selectPlan(context, { email })

    const create = await w3
      .args([
        'space',
        'create',
        'home',
        '--no-recovery',
        '--no-account',
        '--no-gateway-authorization',
        '--customer',
        email,
      ])
      .env(context.env.alice)
      .join()

    assert.ok(create.status.success())

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg', '--no-wrap'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafkreiajkbmpugz75eg2tmocmp3e33sg5kuyq2amzngslahgn6ltmqxxfa/
    )
    assert.match(up.error, /Stored 1 file/)
  }),

  'w3 up --wrap false': test(async (assert, context) => {
    const email = 'alice@web.mail'
    await login(context, { email })
    await selectPlan(context, { email })

    const create = await w3
      .args([
        'space',
        'create',
        'home',
        '--no-recovery',
        '--no-account',
        '--no-gateway-authorization',
        '--customer',
        email,
      ])
      .env(context.env.alice)
      .join()

    assert.ok(create.status.success())

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg', '--wrap', 'false'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafkreiajkbmpugz75eg2tmocmp3e33sg5kuyq2amzngslahgn6ltmqxxfa/
    )
    assert.match(up.error, /Stored 1 file/)
  }),

  'w3 up --car': test(async (assert, context) => {
    const email = 'alice@web.mail'
    await login(context, { email })
    await selectPlan(context, { email })
    await w3
      .args([
        'space',
        'create',
        'home',
        '--no-recovery',
        '--no-account',
        '--no-gateway-authorization',
        '--customer',
        email,
      ])
      .env(context.env.alice)
      .join()

    const up = await w3
      .args(['up', '--car', 'test/fixtures/pinpie.car'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafkreiajkbmpugz75eg2tmocmp3e33sg5kuyq2amzngslahgn6ltmqxxfa/
    )
    assert.match(up.error, /Stored 1 file/)
  }),

  'w3 ls': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const list0 = await w3.args(['ls']).env(context.env.alice).join()
    assert.match(list0.output, /No uploads in space/)

    await w3
      .args(['up', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    // wait a second for invocation to get a different expiry
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const list1 = await w3.args(['ls', '--json']).env(context.env.alice).join()

    assert.ok(dagJSON.parse(list1.output))
  }),

  'w3 remove': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
    )

    const rm = await w3
      .args([
        'rm',
        'bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea',
      ])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(rm.status.code, 0)
    assert.equal(rm.output, '')
  }),

  'w3 remove - no such upload': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const rm = await w3
      .args([
        'rm',
        'bafybeih2k7ughhfwedltjviunmn3esueijz34snyay77zmsml5w24tqamm',
        '--shards',
      ])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(rm.status.code, 1)
    assert.match(
      rm.error,
      /not found/
    )
  }),
}

export const testDelegation = {
  'w3 delegation create -c store/* --output file/path': test(
    async (assert, context) => {
      const env = context.env.alice
      const { bob } = Test

      const spaceDID = await loginAndCreateSpace(context)

      const proofPath = path.join(
        os.tmpdir(),
        `w3cli-test-delegation-${Date.now()}`
      )

      await w3
        .args([
          'delegation',
          'create',
          bob.did(),
          '-c',
          'store/*',
          '--output',
          proofPath,
        ])
        .env(env)
        .join()

      const reader = await CarReader.fromIterable(
        fs.createReadStream(proofPath)
      )
      const blocks = []
      for await (const block of reader.blocks()) {
        blocks.push(block)
      }

      // @ts-expect-error
      const delegation = importDAG(blocks)
      assert.equal(delegation.audience.did(), bob.did())
      assert.equal(delegation.capabilities[0].can, 'store/*')
      assert.equal(delegation.capabilities[0].with, spaceDID)
    }
  ),

  'w3 delegation create': test(async (assert, context) => {
    const env = context.env.alice
    const { bob } = Test
    await loginAndCreateSpace(context)

    const delegate = await w3
      .args(['delegation', 'create', bob.did()])
      .env(env)
      .join()

    // TODO: Test output after we switch to Delegation.archive() / Delegation.extract()
    assert.equal(delegate.status.success(), true)
  }),

  'w3 delegation create -c store/add -c upload/add --base64': test(
    async (assert, context) => {
      const env = context.env.alice
      const { bob } = Test
      const spaceDID = await loginAndCreateSpace(context)
      const res = await w3
        .args([
          'delegation',
          'create',
          bob.did(),
          '-c',
          'store/add',
          '-c',
          'upload/add',
          '--base64'
        ])
        .env(env)
        .join()

      assert.equal(res.status.success(), true)

      const identityCid = parseLink(res.output, base64)
      const reader = await CarReader.fromBytes(identityCid.multihash.digest)
      const blocks = []
      for await (const block of reader.blocks()) {
        blocks.push(block)
      }

      // @ts-expect-error
      const delegation = importDAG(blocks)
      assert.equal(delegation.audience.did(), bob.did())
      assert.equal(delegation.capabilities[0].can, 'store/add')
      assert.equal(delegation.capabilities[0].with, spaceDID)
      assert.equal(delegation.capabilities[1].can, 'upload/add')
      assert.equal(delegation.capabilities[1].with, spaceDID)
    }
  ),

  'w3 delegation ls --json': test(async (assert, context) => {
    const { mallory } = Test

    const spaceDID = await loginAndCreateSpace(context)

    // delegate to mallory
    await w3
      .args(['delegation', 'create', mallory.did(), '-c', 'store/*'])
      .env(context.env.alice)
      .join()

    const list = await w3
      .args(['delegation', 'ls', '--json'])
      .env(context.env.alice)
      .join()

    const data = JSON.parse(list.output)

    assert.equal(data.audience, mallory.did())
    assert.equal(data.capabilities.length, 1)
    assert.equal(data.capabilities[0].with, spaceDID)
    assert.equal(data.capabilities[0].can, 'store/*')
  }),

  'w3 delegation revoke': test(async (assert, context) => {
    const env = context.env.alice
    const { mallory } = Test
    await loginAndCreateSpace(context)

    const delegationPath = `${os.tmpdir()}/delegation-${Date.now()}.ucan`
    await w3
      .args([
        'delegation',
        'create',
        mallory.did(),
        '-c',
        'store/*',
        'upload/*',
        '-o',
        delegationPath,
      ])
      .env(env)
      .join()

    const list = await w3
      .args(['delegation', 'ls', '--json'])
      .env(context.env.alice)
      .join()
    const { cid } = JSON.parse(list.output)

    // alice should be able to revoke the delegation she just created
    const revoke = await w3
      .args(['delegation', 'revoke', cid])
      .env(context.env.alice)
      .join()

    assert.match(revoke.output, pattern`delegation ${cid} revoked`)

    await loginAndCreateSpace(context, {
      env: context.env.bob,
      customer: 'bob@super.host',
    })

    // bob should not be able to because he doesn't have a copy of the delegation
    const fail = await w3
      .args(['delegation', 'revoke', cid])
      .env(context.env.bob)
      .join()
      .catch()

    assert.match(
      fail.error,
      pattern`Error: revoking ${cid}: could not find delegation ${cid}`
    )

    // but if bob passes the delegation manually, it should succeed - we don't
    // validate that bob is able to issue the revocation, it simply won't apply
    // if it's not legitimate

    const pass = await w3
      .args(['delegation', 'revoke', cid, '-p', delegationPath])
      .env(context.env.bob)
      .join()

    assert.match(pass.output, pattern`delegation ${cid} revoked`)
  }),
}

export const testProof = {
  'w3 proof add': test(async (assert, context) => {
    const { env } = context

    const spaceDID = await loginAndCreateSpace(context, { env: env.alice })
    const whoisbob = await w3.args(['whoami']).env(env.bob).join()
    const bobDID = DID.parse(whoisbob.output.trim()).did()
    const proofPath = path.join(
      os.tmpdir(),
      `w3cli-test-delegation-${Date.now()}`
    )

    await w3
      .args([
        'delegation',
        'create',
        bobDID,
        '-c',
        'store/*',
        '--output',
        proofPath,
      ])
      .env(env.alice)
      .join()

    const listNone = await w3.args(['proof', 'ls']).env(env.bob).join()
    assert.ok(!listNone.output.includes(spaceDID))

    const addProof = await w3
      .args(['proof', 'add', proofPath])
      .env(env.bob)
      .join()

    assert.ok(addProof.output.includes(`with: ${spaceDID}`))
    const listProof = await w3.args(['proof', 'ls']).env(env.bob).join()
    assert.ok(listProof.output.includes(spaceDID))
  }),
  'w3 proof add notfound': test(async (assert, context) => {
    const proofAdd = await w3
      .args(['proof', 'add', 'djcvbii'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(proofAdd.status.success(), false)
    assert.match(proofAdd.error, /failed to read proof/)
  }),
  'w3 proof add not-car.json': test(async (assert, context) => {
    const proofAdd = await w3
      .args(['proof', 'add', './package.json'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(proofAdd.status.success(), false)
    assert.match(proofAdd.error, /failed to parse proof/)
  }),
  'w3 proof add invalid.car': test(async (assert, context) => {
    const proofAdd = await w3
      .args(['proof', 'add', './test/fixtures/empty.car'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.equal(proofAdd.status.success(), false)
    assert.match(proofAdd.error, /failed to import proof/)
  }),
  'w3 proof ls': test(async (assert, context) => {
    const { env } = context
    const spaceDID = await loginAndCreateSpace(context, { env: env.alice })
    const whoisalice = await w3.args(['whoami']).env(env.alice).join()
    const aliceDID = DID.parse(whoisalice.output.trim()).did()

    const whoisbob = await w3.args(['whoami']).env(env.bob).join()
    const bobDID = DID.parse(whoisbob.output.trim()).did()

    const proofPath = path.join(os.tmpdir(), `w3cli-test-proof-${Date.now()}`)
    await w3
      .args([
        'delegation',
        'create',
        '-c',
        'store/*',
        bobDID,
        '--output',
        proofPath,
      ])
      .env(env.alice)
      .join()

    await w3.args(['space', 'add', proofPath]).env(env.bob).join()

    const proofList = await w3
      .args(['proof', 'ls', '--json'])
      .env(env.bob)
      .join()
    const proofData = JSON.parse(proofList.output)
    assert.equal(proofData.iss, aliceDID)
    assert.equal(proofData.att.length, 1)
    assert.equal(proofData.att[0].with, spaceDID)
    assert.equal(proofData.att[0].can, 'store/*')
  }),
}

export const testBlob = {
  'w3 can blob add': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const { error } = await w3
      .args(['can', 'blob', 'add', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    assert.match(error, /Stored zQm/)
  }),

  'w3 can blob ls': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    await w3
      .args(['can', 'blob', 'add', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    const list = await w3
      .args(['can', 'blob', 'ls', '--json'])
      .env(context.env.alice)
      .join()

    assert.ok(dagJSON.parse(list.output))
  }),

  'w3 can blob rm': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    await w3
      .args(['can', 'blob', 'add', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    const list = await w3
      .args(['can', 'blob', 'ls', '--json'])
      .env(context.env.alice)
      .join()

    const digest = Digest.decode(dagJSON.parse(list.output).blob.digest)

    const remove = await w3
      .args(['can', 'blob', 'rm', base58btc.encode(digest.bytes)])
      .env(context.env.alice)
      .join()

    assert.match(remove.error, /Removed zQm/)
  }),
}

export const testStore = {
  'w3 can store add': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const { error } = await w3
      .args(['can', 'store', 'add', 'test/fixtures/pinpie.car'])
      .env(context.env.alice)
      .join()

    assert.match(error, /Stored bag/)
  }),
}

export const testCan = {
  'w3 can upload add': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const carPath = 'test/fixtures/pinpie.car'
    const reader = await CarReader.fromBytes(
      await fs.promises.readFile(carPath)
    )
    const root = (await reader.getRoots())[0]?.toString()
    assert.ok(root)

    const canStore = await w3
      .args(['can', 'store', 'add', carPath])
      .env(context.env.alice)
      .join()

    assert.match(canStore.error, /Stored bag/)

    const shard = canStore.output.trim()
    const canUpload = await w3
      .args(['can', 'upload', 'add', root, shard])
      .env(context.env.alice)
      .join()

    assert.match(canUpload.error, /Upload added/)
  }),

  'w3 can upload ls': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    await w3
      .args(['up', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    const list = await w3
      .args(['can', 'upload', 'ls', '--json'])
      .env(context.env.alice)
      .join()

    assert.ok(dagJSON.parse(list.output))
  }),
  'w3 can upload rm': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg'])
      .env(context.env.alice)
      .join()

    assert.match(
      up.output,
      /bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea/
    )

    const noPath = await w3
      .args(['can', 'upload', 'rm'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(noPath.error, /Insufficient arguments/)

    const invalidCID = await w3
      .args(['can', 'upload', 'rm', 'foo'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(invalidCID.error, /not a CID/)

    const rm = await w3
      .args([
        'can',
        'upload',
        'rm',
        'bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea',
      ])
      .env(context.env.alice)
      .join()

    assert.ok(rm.status.success())
  }),
  'w3 can store ls': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    await w3
      .args(['can', 'store', 'add', 'test/fixtures/pinpie.car'])
      .env(context.env.alice)
      .join()

    const list = await w3
      .args(['can', 'store', 'ls', '--json'])
      .env(context.env.alice)
      .join()

    assert.ok(dagJSON.parse(list.output))
  }),
  'w3 can store rm': test(async (assert, context) => {
    const space = await loginAndCreateSpace(context)

    await w3
      .args(['can', 'store', 'add', 'test/fixtures/pinpie.car'])
      .env(context.env.alice)
      .join()

    const stores = await context.storeTable.list(space)
    const store = stores.ok?.results[0]
    if (!store) {
      return assert.ok(store, 'stored item should appear in list')
    }

    const missingArg = await w3
      .args(['can', 'store', 'rm'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(missingArg.error, /Insufficient arguments/)

    const invalidCID = await w3
      .args(['can', 'store', 'rm', 'foo'])
      .env(context.env.alice)
      .join()
      .catch()

    assert.match(invalidCID.error, /not a CAR CID/)

    const notCarCID = await w3
      .args(['can', 'store', 'rm', 'bafybeiajdopsmspomlrpaohtzo5sdnpknbolqjpde6huzrsejqmvijrcea'])
      .env(context.env.alice)
      .join()
      .catch()
    assert.match(notCarCID.error, /not a CAR CID/)

    const rm = await w3
      .args(['can', 'store', 'rm', store.link.toString()])
      .env(context.env.alice)
      .join()

    assert.ok(rm.status.success())
  }),
  'can filecoin info with not found': test(async (assert, context) => {
    await loginAndCreateSpace(context)

    const up = await w3
      .args(['up', 'test/fixtures/pinpie.jpg', '--verbose'])
      .env(context.env.alice)
      .join()
    const pieceCid = up.error.split('Piece CID: ')[1].split(`\n`)[0]

    const { error } = await w3
      .args(['can', 'filecoin', 'info', pieceCid, '--json'])
      .env(context.env.alice)
      .join()
      .catch()
    // no piece will be available right away
    assert.ok(error)
    assert.ok(error.includes('not found'))
  }),
}

export const testPlan = {
  'w3 plan get': test(async (assert, context) => {
    await login(context)
    const notFound = await w3
      .args(['plan', 'get'])
      .env(context.env.alice)
      .join()

    assert.match(notFound.output, /no plan/i)

    await selectPlan(context)

    // wait a second for invocation to get a different expiry
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const plan = await w3.args(['plan', 'get']).env(context.env.alice).join()
    assert.match(plan.output, /did:web:free.web3.storage/)
  }),
}

export const testKey = {
  'w3 key create': test(async (assert) => {
    const res = await w3.args(['key', 'create', '--json']).join()
    const key = ED25519.parse(JSON.parse(res.output).key)
    assert.ok(key.did().startsWith('did:key'))
  }),
}

export const testBridge = {
  'w3 bridge generate-tokens': test(async (assert, context) => {
    const spaceDID = await loginAndCreateSpace(context)
    const res = await w3.args(['bridge', 'generate-tokens', spaceDID]).join()
    assert.match(res.output, /X-Auth-Secret header: u/)
    assert.match(res.output, /Authorization header: u/)
  }),
}

/**
 * @param {Test.Context} context
 * @param {object} options
 * @param {string} [options.email]
 * @param {Record<string, string>} [options.env]
 */
export const login = async (
  context,
  { email = 'alice@web.mail', env = context.env.alice } = {}
) => {
  const login = w3.env(env).args(['login', email]).fork()

  // wait for the new process to print the status
  await login.error.lines().take().text()

  // receive authorization request
  const message = await context.mail.take()

  // confirm authorization
  await context.grantAccess(message)

  return await login.join()
}

/**
 * @typedef {import('@web3-storage/w3up-client/types').ProviderDID} Plan
 *
 * @param {Test.Context} context
 * @param {object} options
 * @param {DIDMailto.EmailAddress} [options.email]
 * @param {string} [options.billingID]
 * @param {Plan} [options.plan]
 */
export const selectPlan = async (
  context,
  { email = 'alice@web.mail', billingID = 'test:cus_alice', plan = 'did:web:free.web3.storage' } = {}
) => {
  const customer = DIDMailto.fromEmail(email)
  Result.try(await context.plansStorage.initialize(customer, billingID, plan))
}

/**
 * @param {Test.Context} context
 * @param {object} options
 * @param {DIDMailto.EmailAddress|null} [options.customer]
 * @param {string} [options.name]
 * @param {Record<string, string>} [options.env]
 */
export const createSpace = async (
  context,
  { customer = 'alice@web.mail', name = 'home', env = context.env.alice } = {}
) => {
  const { output } = await w3
    .args([
      'space',
      'create',
      name,
      '--no-recovery',
      '--no-account',
      '--no-gateway-authorization',
      ...(customer ? ['--customer', customer] : ['--no-customer']),
    ])
    .env(env)
    .join()

  const [did] = match(/(did:key:\w+)/, output)

  return SpaceDID.from(did)
}

/**
 * @param {Test.Context} context
 * @param {object} options
 * @param {DIDMailto.EmailAddress} [options.email]
 * @param {DIDMailto.EmailAddress|null} [options.customer]
 * @param {string} [options.name]
 * @param {Plan} [options.plan]
 * @param {Record<string, string>} [options.env]
 */
export const loginAndCreateSpace = async (
  context,
  {
    email = 'alice@web.mail',
    customer = email,
    name = 'home',
    plan = 'did:web:free.web3.storage',
    env = context.env.alice,
  } = {}
) => {
  await login(context, { email, env })

  if (customer != null && plan != null) {
    await selectPlan(context, { email: customer, plan })
  }

  return createSpace(context, { customer, name, env })
}

/**
 * @param {Test.Context} context
 * @param {object} options
 * @param {string} [options.password]
 */
export const createCustomerSession = async (
  context,
  { password = '' } = {}
) => {
  // Derive delegation audience from the password
  const { digest } = await sha256.digest(new TextEncoder().encode(password))
  const audience = await ED25519.derive(digest)

  // Generate the agent that will be authorized to act on behalf of the customer
  const agent = await ed25519.generate()

  const customer = Absentee.from({ id: 'did:mailto:web.mail:workshop' })

  // First we create delegation from the customer to the agent that authorizing
  // it to perform `provider/add` on their behalf.
  const delegation = await delegate({
    issuer: customer,
    audience: agent,
    capabilities: [
      {
        with: 'ucan:*',
        can: '*',
      },
    ],
    expiration: Infinity,
  })

  // Then we create an attestation from the service to proof that agent has
  // been authorized
  const attestation = await UCAN.attest.delegate({
    issuer: context.service,
    audience: agent,
    with: context.service.did(),
    nb: { proof: delegation.cid },
    expiration: delegation.expiration,
  })

  // Finally we create a short lived session that authorizes the audience to
  // provider/add with their billing account.
  const session = await Provider.add.delegate({
    issuer: agent,
    audience,
    with: customer.did(),
    proofs: [delegation, attestation],
  })

  return Result.try(await session.archive())
}
