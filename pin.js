import LRUMap from 'mnemonist/lru-map.js'
import { CID } from 'multiformats'
import http from 'node:http'
import { getPkg, getClient } from './lib.js'

/**
 * a pinning service api on your localhost
 *
 * ## Example
 *   w3 ps --port 1337
 *
 * @param {object} config
 * @param {string} config.port
 * @param {string} config.host
 * @param {string} config.key
 */
export async function startPinService ({ port = '1337', host = '127.0.0.1', key }) {
  const pkg = getPkg()
  /** @type LRUMap<string, PinStatus> */
  const pinCache = new LRUMap(100_000)
  const client = await getClient()
  const whoami = client.agent().did()
  const token = key ?? whoami
  const api = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      return send({ res, status: 401, body: { error: { reason: 'Unauthorized; access token is missing or invalid' } } })
    }
    const { pathname } = new URL(req.url ?? '', `http://${req.headers.host}`)
    if (pathname === '/' || pathname === '') {
      return send({ res, body: { service: 'w3', version: pkg.version } })
    }
    if (req.method === 'POST' && pathname === '/pins') {
      const reqBody = await getJsonBody(req)
      if (reqBody.error) {
        return send({ status: 400, res, body: reqBody })
      }
      const { cid } = reqBody
      const pinStatus = await addPin({ cid, client })
      if (pinStatus.error) {
        return send({ status: 400, res, body: pinStatus })
      }
      pinCache.set(pinStatus.requestid, pinStatus)
      return send({ res, body: pinStatus })
    }
    if (req.method === 'GET' && pathname.startsWith('/pins/')) {
      const requestid = pathname.split('/').at(2)
      if (!requestid) {
        return send({ res, status: 404, body: { error: { reason: 'Not Found', details: requestid } } })
      }
      const pinStatus = pinCache.get(requestid)
      if (pinStatus) {
        return send({ res, body: pinStatus })
      }
      return send({ res, status: 404, body: { error: { reason: 'Not Found', details: requestid } } })
    }
    return send({ res, status: 501, body: { error: { reason: 'Not Implemented', details: `${req.method} ${pathname}` } } })
  })
  api.listen(parseInt(port, 10), host, () => {
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
 * @param {import('@web3-storage/w3up-client').Client} config.client
 * @param {string} config.cid
 * @param {string} [config.ipfsGatewayUrl]
 * @param {AbortSignal} [config.signal]
 * @returns {Promise<PinStatus|ErrorStatus>}
 */
export async function addPin ({ client, cid, ipfsGatewayUrl = 'http://127.0.0.1:8080', signal }) {
  let rootCID
  let ipfsUrl
  /** @type Response | undefined */
  let res

  try {
    rootCID = CID.parse(cid)
  } catch (err) {
    return errorResponse(`Failed to parse ${cid} as a CID`)
  }

  try {
    ipfsUrl = new URL(`/ipfs/${cid}?format=car`, ipfsGatewayUrl)
  } catch (err) {
    return errorResponse(`Failed to parse ${ipfsGatewayUrl} /ipfs/${cid}?format=car`)
  }

  try {
    res = await fetch(ipfsUrl, { signal })
  } catch (err) {
    return errorResponse(`Error fetching CAR from IPFS ${ipfsUrl}`, err.message ?? err)
  }

  if (!res.ok) {
    return errorResponse(`http status ${res.status} fetching CAR from IPFS ${ipfsUrl}`)
  }

  let shardCount = 0
  let byteCount = 0

  await client.uploadCAR({ stream: () => res.body }, {
    onShardStored: (meta) => { shardCount++; byteCount += meta.size },
    rootCID,
    signal
  })

  console.log(`${new Date().toISOString()} uploaded ${cid} (shards: ${shardCount}, total bytes sent: ${byteCount} )`)
  return pinResponse(cid, 'pinned')
}

/**
 * @typedef {{requestid: string, status: 'pinned' | 'failed', created: string, pin: { cid: string }, delegates: [], error?: undefined }} PinStatus
 *
 * @param {string} cidStr
 * @param {'pinned' | 'failed'} status
 * @returns {PinStatus}
 */
function pinResponse (cidStr, status = 'pinned') {
  return {
    requestid: cidStr,
    status,
    created: new Date().toISOString(),
    pin: {
      cid: cidStr
    },
    delegates: []
  }
}

/**
 * @typedef {{error: { reason: string, details: string }}} ErrorStatus
 *
 * @param {string} details
 * @returns {ErrorStatus}
 */
function errorResponse (details) {
  console.error(`${new Date().toISOString()} Error: ${details}`)
  return {
    error: {
      reason: 'BAD_REQUEST',
      details
    }
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
  const contentLength = parseInt(req.headers['content-length'] || '0', 10)
  if (contentLength > 100 * 1024) {
    return errorResponse('Request body too large')
  }
  const contentType = req.headers['content-type']
  if (contentType !== 'application/json') {
    return errorResponse('Request body must be be content-type: application/json')
  }
  let body = ''
  for await (const chonk of req) {
    body += chonk
    if (Buffer.byteLength(body, 'utf-8') > contentLength) {
      return errorResponse('Request body size exceeds specfied content-length')
    }
  }
  if (Buffer.byteLength(body, 'utf-8') !== contentLength) {
    return errorResponse('Request body size does not match specified content-length')
  }
  try {
    return JSON.parse(body)
  } catch (err) {
    return errorResponse('Request body is not valid json', err.message ?? err)
  }
}
