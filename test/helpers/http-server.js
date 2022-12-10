import http from 'http'
import { once } from 'events'

/**
 * @typedef {{
*   server: http.Server
*   serverURL: URL
*   setRequestListener: (l: http.RequestListener) => void
* }} TestingServer
*/

/** @returns {Promise<TestingServer>} */
export async function createServer () {
  /** @type {http.RequestListener} */
  let listener = (_, response) => {
    response.statusCode = 500
    response.write('no request listener set')
    response.end()
  }

  const server = http.createServer((request, response) => {
    listener(request, response)
  }).listen()

  await once(server, 'listening')

  return {
    server,
    // @ts-expect-error
    serverURL: new URL(`http://127.0.0.1:${server.address().port}`),
    setRequestListener: l => { listener = l }
  }
}
