import { CID } from 'multiformats'
import http from 'node:http'
import { getPkg, getClient } from './lib.js'

/**
 * a pinning service api on your localhost
 *
 * ## Example
 *   w3 ps --port 1337
 */
export async function startPinService ({ port, host = '127.0.0.1', key }) {
  const pkg = getPkg()
  const pinCache = new Map()
  const client = await getClient()
  const whoami = client.agent().did()
  const token = key ?? whoami
  const api = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      return send({ res, status: 401, body: { error: { reason: 'Unauthorized; access token is missing or invalid' } } })
    }
    const { pathname } = new URL(req.url, `http://${req.headers.host}`)
    if (pathname === '/' || pathname === '') {
      return send({ res, body: { service: 'w3', version: pkg.version } })
    }
    if (req.method === 'POST' && pathname === '/pins') {
      const body = await getJsonBody(req)
      const pinStatus = await addPin({ ...body, client })
      pinCache.set(pinStatus.requestid, pinStatus)
      return send({ res, body: pinStatus })
    }
    if (req.method === 'GET' && pathname.startsWith('/pins/')) {
      const requestid = pathname.split('/').at(2)
      const pinStatus = pinCache.get(requestid)
      if (pinStatus) {
        return send({ res, body: pinStatus })
      }
      return send({ res, status: 404, body: { error: { reason: 'Not Found', details: requestid } } })
    }
    return send({ res, status: 501, body: { error: { reason: 'Not Implmented', details: `${req.method} ${pathname}` } } })
  })
  api.listen(port, host, () => {
    console.log(`⁂ IPFS Pinning Service on http://127.0.0.1:1337

## Add w3 as a remote
$ ipfs pin remote service add w3 'http://${host}:${port}' '${token}'

## Pin to w3
$ ipfs pin remote add --service w3 <cid>

## Waiting for requests`)
  })
}

/**
 * @param {object} config
 * @param {import('@web3-storage/w3up-client').Client} confg.client
 * @param {string} config.cid
 * @param {string} [config.ipfsGatewayUrl]
 * @param {AbortSignal} [config.signal]
 */
export async function addPin ({ client, cid, ipfsGatewayUrl = 'http://127.0.0.1:8080', signal }) {
  const rootCID = CID.parse(cid)
  const ipfsUrl = new URL(`/ipfs/${cid}?format=car`, ipfsGatewayUrl, { signal })
  const res = await fetch(ipfsUrl)
  const storedCID = await client.uploadCAR({ stream: () => res.body }, {
    onShardStored: (car) => console.log(`${new Date().toISOString()} ${car.cid} shard stored`),
    rootCID,
    signal

  })
  console.log(`${new Date().toISOString()} ${storedCID} uploaded`)
  return {
    // we use cid as requestid to avoid needing to track extra state
    requestid: storedCID.toString(),
    status: 'pinned',
    created: new Date().toISOString(),
    pin: {
      cid: storedCID.toString()
    },
    delgates: []
  }
}

/**
 * @param {object} config
 * @param {http.OutgoingMessage} config.res
 * @param {object} config.body
 * @param {number} [config.status]
 * @param {string} [config.contentType]
 */
function send ({ res, body, status = 200, contentType = 'application/json' }) {
  res.setHeader('Content-Type', 'application/json')
  res.writeHead(status)
  const str = contentType === 'application/json' ? JSON.stringify(body) : body
  res.end(str)
}

/**
 * @param {http.IncomingMessage} req
 */
export async function getJsonBody (req) {
  const contentlength = parseInt(req.headers['content-length'] || 0, 10)
  if (contentlength > 100 * 1024) {
    throw new Error('Request body too large')
  }
  const contentType = req.headers['content-type']
  if (contentType !== 'application/json') {
    throw new Error('Request body must be be content-type: application/json')
  }
  let body = ''
  for await (const chonk of req) {
    body += chonk
    if (Buffer.byteLength(body, 'utf-8') > contentlength) {
      throw new Error('Request body size exceeds specfied content-length')
    }
  }
  if (Buffer.byteLength(body, 'utf-8') !== contentlength) {
    throw new Error('Request body size does not match specified content-length')
  }
  return JSON.parse(body)
}
