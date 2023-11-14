/**
 * @typedef {import('@ucanto/interface').HTTPRequest<any>} HTTPRequest
 * @typedef {import('@ucanto/server').HTTPResponse<any>} HTTPResponse
 *
 * @param {Record<string, (input:HTTPRequest) => PromiseLike<HTTPResponse>|HTTPResponse>} router
 * @returns {import('http').RequestListener}
 */
export function createHTTPListener(router) {
  return async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }

    const handler = router[request.url ?? '/']
    if (!handler) {
      response.writeHead(404)
      response.end()
      return
    }

    const { headers, body } = await handler({
      // @ts-ignore
      headers: request.headers,
      body: Buffer.concat(chunks),
    })

    response.writeHead(200, headers)
    response.write(body)
    response.end()
  }
}
