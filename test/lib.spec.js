import test from 'ava'
import * as Link from 'multiformats/link'
import {
  filesize,
  uploadListResponseToString,
  storeListResponseToString
} from '../lib.js'

/**
 * @typedef {import('multiformats').LinkJSON} LinkJSON
 * @typedef {import('@web3-storage/w3up-client/types').CARLink} CARLink
 */

test('filesize', t => {
  /** @type {Array<[number, string]>} */
  const testdata = [
    [5, '5B'],
    [50, '0.1KB'],
    [500, '0.5KB'],
    [5_000, '5.0KB'],
    [50_000, '0.1MB'],
    [500_000, '0.5MB'],
    [5_000_000, '5.0MB'],
    [50_000_000, '0.1GB'],
    [500_000_000, '0.5GB'],
    [5_000_000_000, '5.0GB']
  ]
  testdata.forEach(([size, str]) => t.is(filesize(size), str))
})

/** @type {import('@web3-storage/w3up-client/types').UploadListOk} */
const uploadListResponse = {
  size: 2,
  cursor: 'bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje',
  results: [
    {
      root: Link.parse('bafybeia7tr4dgyln7zeyyyzmkppkcts6azdssykuluwzmmswysieyadcbm'),
      shards: [Link.parse('bagbaierantza4rfjnhqksp2stcnd2tdjrn3f2kgi2wrvaxmayeuolryi66fq')]
    },
    {
      root: Link.parse('bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje'),
      shards: [Link.parse('bagbaieraxqbkzwvx5on6an4br5hagfgesdfc6adchy3hf5qt34pupfjd3rbq')]
    }
  ],
  after: 'bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje',
  before: 'bafybeia7tr4dgyln7zeyyyzmkppkcts6azdssykuluwzmmswysieyadcbm'
}

test('uploadListResponseToString can return the upload roots CIDs as strings', (t) => {
  t.is(
    uploadListResponseToString(uploadListResponse, {}),
    `bafybeia7tr4dgyln7zeyyyzmkppkcts6azdssykuluwzmmswysieyadcbm
bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje`
  )
})

test('uploadListResponseToString can return the upload roots as newline delimited JSON', (t) => {
  t.is(
    uploadListResponseToString(uploadListResponse, { shards: true }),
    `bafybeia7tr4dgyln7zeyyyzmkppkcts6azdssykuluwzmmswysieyadcbm
└─┬ shards
  └── bagbaierantza4rfjnhqksp2stcnd2tdjrn3f2kgi2wrvaxmayeuolryi66fq

bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje
└─┬ shards
  └── bagbaieraxqbkzwvx5on6an4br5hagfgesdfc6adchy3hf5qt34pupfjd3rbq
`
  )
})

test('uploadListResponseToString can return the upload roots and shards as a tree', (t) => {
  t.is(
    uploadListResponseToString(uploadListResponse, { json: true }),
    `{"root":{"/":"bafybeia7tr4dgyln7zeyyyzmkppkcts6azdssykuluwzmmswysieyadcbm"},"shards":[{"/":"bagbaierantza4rfjnhqksp2stcnd2tdjrn3f2kgi2wrvaxmayeuolryi66fq"}]}
{"root":{"/":"bafybeibvbxjeodaa6hdqlgbwmv4qzdp3bxnwdoukay4dpl7aemkiwc2eje"},"shards":[{"/":"bagbaieraxqbkzwvx5on6an4br5hagfgesdfc6adchy3hf5qt34pupfjd3rbq"}]}`
  )
})

/** @type {import('@web3-storage/w3up-client/types').StoreListOk} */
const storeListResponse = {
  size: 2,
  cursor: 'bagbaieracmkgwrw6rowsk5jse5eihyhszyrq5w23aqosajyckn2tfbotdcqq',
  results: [
    { link: Link.parse('bagbaierablvu5d2q5uoimuy2tlc3tcntahnw2j7s7jjaznawc23zgdgcisma'), size: 5336 },
    { link: Link.parse('bagbaieracmkgwrw6rowsk5jse5eihyhszyrq5w23aqosajyckn2tfbotdcqq'), size: 3297 }
  ],
  after: 'bagbaieracmkgwrw6rowsk5jse5eihyhszyrq5w23aqosajyckn2tfbotdcqq',
  before: 'bagbaierablvu5d2q5uoimuy2tlc3tcntahnw2j7s7jjaznawc23zgdgcisma'
}

test('storeListResponseToString can return the CAR CIDs as strings', (t) => {
  t.is(
    storeListResponseToString(storeListResponse, {}),
    `bagbaierablvu5d2q5uoimuy2tlc3tcntahnw2j7s7jjaznawc23zgdgcisma
bagbaieracmkgwrw6rowsk5jse5eihyhszyrq5w23aqosajyckn2tfbotdcqq`
  )
})

test('storeListResponseToString can return the CAR CIDs as newline delimited JSON', (t) => {
  t.is(
    storeListResponseToString(storeListResponse, { json: true }),
    `{"link":{"/":"bagbaierablvu5d2q5uoimuy2tlc3tcntahnw2j7s7jjaznawc23zgdgcisma"},"size":5336}
{"link":{"/":"bagbaieracmkgwrw6rowsk5jse5eihyhszyrq5w23aqosajyckn2tfbotdcqq"},"size":3297}`
  )
})
